import { useState } from 'react';
import { Icon } from '../ui/icons';
import { Select } from '../ui/Select';
import { useChartStore } from '../store/chartStore';
import { useAlertDialogStore } from '../store/alertDialogStore';
import { useAlertStore } from '../store/alertStore';
import type { AlertOp, NotifyChannel } from '../store/alertStore';
import { OP_LABELS, NOTIFY_LABELS, alertMessage } from '../store/alertStore';
import { SYMBOL_BY_TICKER } from '../data/symbols';
import { formatPrice } from '../data/quote';
import { useToast } from '../ui/toast';

const OP_OPTIONS = (Object.keys(OP_LABELS) as AlertOp[]).map((op) => ({ value: op, label: OP_LABELS[op] }));
const TRIGGER_OPTIONS = [
  { value: 'once', label: '仅一次' },
  { value: 'every', label: '每次' },
];
const EXPIRY_OPTIONS = [
  { value: '', label: '不设置' },
  { value: '1d', label: '1 天后' },
  { value: '1w', label: '1 周后' },
  { value: '1m', label: '1 个月后' },
];
const NOTIFY_OPTIONS = (Object.keys(NOTIFY_LABELS) as NotifyChannel[]).map((ch) => ({ value: ch, label: NOTIFY_LABELS[ch] }));

const DAY = 86_400_000;
const EXPIRY_MS: Record<string, number> = { '1d': DAY, '1w': 7 * DAY, '1m': 30 * DAY };

const fmt2 = (n: number): string => String(Math.round(n * 100) / 100);

/** 创建警报对话框（设计稿：TradingView「创建警报」）。标签在左 130px、控件在右。 */
export function AlertDialog(): JSX.Element | null {
  const open = useAlertDialogStore((s) => s.open);
  const close = useAlertDialogStore((s) => s.closeDialog);
  const ticker = useChartStore((s) => s.symbol);
  const lastPrice = useChartStore((s) => s.lastPrice);
  const addAlert = useAlertStore((s) => s.addAlert);
  const toast = useToast((s) => s.show);

  const [op, setOp] = useState<AlertOp>('crossing');
  const [value, setValue] = useState('');
  const [trigger, setTrigger] = useState<'once' | 'every'>('once');
  const [expiry, setExpiry] = useState('');
  const [notify, setNotify] = useState<NotifyChannel[]>(['app', 'popup']);

  // 每次打开都在 render 阶段同步重置（useEffect 会和「打开后立刻填表」竞速）
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    const entry = SYMBOL_BY_TICKER.get(useChartStore.getState().symbol);
    const seed = useChartStore.getState().lastPrice ?? entry?.last ?? 0;
    setOp('crossing');
    setValue(fmt2(seed));
    setTrigger('once');
    setExpiry('');
    setNotify(['app', 'popup']);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  if (!open) return null;
  const entry = SYMBOL_BY_TICKER.get(ticker);
  const num = Number(value);
  const valid = Number.isFinite(num) && num > 0;

  const create = (): void => {
    if (!valid) {
      toast('请输入有效的触发值');
      return;
    }
    addAlert({
      ticker,
      op,
      value: num,
      trigger,
      expires: expiry ? Date.now() + EXPIRY_MS[expiry] : null,
      notify,
    });
    toast(`警报已创建：${alertMessage(ticker, op, num)}`);
    close();
  };

  return (
    <div className="modal-mask center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="alert-dialog" role="dialog" aria-modal="true" aria-label="创建警报">
        <div className="al-head">
          <h2>创建警报</h2>
          <span className="al-chip" title={`${entry?.name ?? ''} · ${entry?.exchange ?? ''}`}>
            {ticker}
            {entry ? ` · ${entry.exchange}` : ''}
          </span>
          <button type="button" className="al-close" aria-label="关闭" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="al-body">
          <div className="al-row">
            <span className="al-label">条件</span>
            <div className="al-cond">
              <span className="al-static" title="触发左值">价格</span>
              <Select variant="field" label="触发条件" value={op} options={OP_OPTIONS} onChange={(v) => setOp(v as AlertOp)} />
              <input
                className="al-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                aria-label="触发值"
                placeholder="值"
              />
            </div>
          </div>

          <div className="al-row">
            <span className="al-label">触发</span>
            <Select variant="field" label="触发次数" value={trigger} options={TRIGGER_OPTIONS} onChange={(v) => setTrigger(v as 'once' | 'every')} />
          </div>

          <div className="al-row">
            <span className="al-label">到期时间</span>
            <Select variant="field" label="到期时间" value={expiry} placeholder="不设置" options={EXPIRY_OPTIONS} onChange={(v) => setExpiry(String(v))} />
          </div>

          <div className="al-row">
            <span className="al-label">消息</span>
            <p className="al-msg">{valid ? alertMessage(ticker, op, num) : `${ticker}，价格 ${OP_LABELS[op]} …`}</p>
          </div>

          <div className="al-row">
            <span className="al-label">通知</span>
            <Select
              variant="field"
              label="通知渠道"
              multiple
              value={notify}
              placeholder="选择通知渠道"
              options={NOTIFY_OPTIONS}
              onChange={(v) => setNotify(v as NotifyChannel[])}
            />
          </div>
        </div>

        <div className="al-foot">
          <button type="button" className="al-btn ghost" onClick={close}>
            取消
          </button>
          <button type="button" className="al-btn solid" onClick={create}>
            创建警报
          </button>
        </div>
      </div>
    </div>
  );
}

/** 便捷格式化（Alerts 页表格用）：条件文本 */
export function alertConditionText(a: { op: AlertOp; value: number }): string {
  return `价格 ${OP_LABELS[a.op]} ${formatPrice(a.value)}`;
}
