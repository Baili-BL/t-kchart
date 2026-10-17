import { useState } from 'react';
import { Icon } from '../ui/icons';
import { Select } from '../ui/Select';
import { ColorPicker } from '../ui/ColorPicker';
import { useSettingsDialogStore } from '../store/settingsDialogStore';
import {
  DEFAULT_SETTINGS, PRECISION_OPTIONS, TZ_OPTIONS, useChartSettingsStore,
} from '../store/chartSettingsStore';
import type { ChartSettings } from '../store/chartSettingsStore';

/** 左侧导航（设计稿 dbf89c6b 的 tab 列表；范围图/样式来自同一稿） */
const TABS = ['商品代码', '状态行', '坐标和线条', '版面', '交易', '警报', '事件', '范围图', '样式'] as const;
type Tab = (typeof TABS)[number];

/** 颜色行：标签 + 色块（点击弹页内调色板）+ 色值文字 */
function ColorRow({
  label, value, onChange, defaultColor, hint,
}: { label: string; value: string; onChange: (v: string) => void; defaultColor: string; hint?: string }): JSX.Element {
  return (
    <div className="st-row st-color" title={hint}>
      <span className="st-row-label">{label}</span>
      <ColorPicker label={label} value={value} onChange={onChange} defaultColor={defaultColor} />
      <span className="st-hex">{value.toUpperCase()}</span>
    </div>
  );
}

/** 勾选行（设计稿是方形勾选框 + 右侧文字） */
function CheckRow({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className="st-row st-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="st-box" aria-hidden="true">
        {checked && <Icon name="check" size={12} />}
      </span>
      <span className="st-row-label">{label}</span>
    </label>
  );
}

/**
 * 图表设置对话框（设计稿：TradingView「设置」两页导入稿）。
 * 草稿语义：打开时快照 store，编辑只动草稿；「确认」提交，「取消」丢弃。
 * 「状态行 / 坐标和线条 / 版面 / 交易 / 警报 / 事件 / 范围图」七组设计稿没给内容，是占位。
 */
export function SettingsDialog(): JSX.Element | null {
  const open = useSettingsDialogStore((s) => s.open);
  const close = useSettingsDialogStore((s) => s.closeDialog);
  const commit = useChartSettingsStore((s) => s.set);

  const [tab, setTab] = useState<Tab>('商品代码');
  const [draft, setDraft] = useState<ChartSettings>(DEFAULT_SETTINGS);

  // 打开时同步草稿（render 阶段重置，避免和「打开后立刻读」竞速）
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(useChartSettingsStore.getState().settings);
    setTab('商品代码');
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  if (!open) return null;
  const put = (patch: Partial<ChartSettings>): void => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="modal-mask center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
        <div className="al-head">
          <h2>设置</h2>
          <button type="button" className="al-close" aria-label="关闭" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="st-body">
          <nav className="st-nav" aria-label="设置分组">
            {TABS.map((t) => (
              <button key={t} type="button" className={'st-tab' + (t === tab ? ' on' : '')} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>

          <div className="st-content">
            {tab === '商品代码' && (
              <>
                <p className="st-sec">商品</p>
                <CheckRow label="Logo" checked={draft.logo} onChange={(v) => put({ logo: v })} />
                <CheckRow label="标题" checked={draft.ticker} onChange={(v) => put({ ticker: v })} />
                <CheckRow label="名称" checked={draft.name} onChange={(v) => put({ name: v })} />
                <CheckRow label="图表值" checked={draft.values} onChange={(v) => put({ values: v })} />
                <CheckRow label="K线变化值" checked={draft.barChange} onChange={(v) => put({ barChange: v })} />
                <CheckRow label="成交量" checked={draft.showVolume} onChange={(v) => put({ showVolume: v })} />
                <CheckRow label="最后一天变化值" checked={draft.lastDayChange} onChange={(v) => put({ lastDayChange: v })} />

                <p className="st-sec">买/卖按钮</p>
                <CheckRow
                  label="图表上直接显示买入和卖出按钮"
                  checked={draft.buySell}
                  onChange={(v) => put({ buySell: v })}
                />

                <p className="st-sec">指标</p>
                <CheckRow label="输入" checked={draft.indInputs} onChange={(v) => put({ indInputs: v })} />
                <CheckRow label="数值" checked={draft.indValues} onChange={(v) => put({ indValues: v })} />
                <CheckRow label="背景" checked={draft.indBg} onChange={(v) => put({ indBg: v })} />
              </>
            )}

            {tab === '样式' && (
              <>
                <p className="st-sec">颜色</p>
                <ColorRow
                  label="上涨烛线"
                  value={draft.upColor}
                  onChange={(v) => put({ upColor: v })}
                  defaultColor={DEFAULT_SETTINGS.upColor}
                  hint="涨的蜡烛 / 成交量柱颜色"
                />
                <ColorRow
                  label="下跌烛线"
                  value={draft.downColor}
                  onChange={(v) => put({ downColor: v })}
                  defaultColor={DEFAULT_SETTINGS.downColor}
                  hint="跌的蜡烛 / 成交量柱颜色"
                />
                <ColorRow
                  label="美国线"
                  value={draft.lineColor}
                  onChange={(v) => put({ lineColor: v })}
                  defaultColor={DEFAULT_SETTINGS.lineColor}
                  hint="美国线 / 折线 / 面积等线族颜色"
                />

                <p className="st-sec">坐标轴</p>
                <div className="st-row">
                  <span className="st-row-label">精确度</span>
                  <Select
                    variant="field"
                    label="价格精确度"
                    value={String(draft.precision)}
                    options={PRECISION_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
                    onChange={(v) => put({ precision: Number(String(v)) })}
                  />
                </div>
                <div className="st-row">
                  <span className="st-row-label">时区</span>
                  <Select
                    variant="field"
                    label="显示时区"
                    value={draft.timezone}
                    options={TZ_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    onChange={(v) => put({ timezone: String(v) })}
                  />
                </div>
              </>
            )}

            {tab !== '商品代码' && tab !== '样式' && (
              <div className="st-empty">
                <Icon name="panel" size={22} />
                <p className="empty-title">{tab}</p>
                <p className="empty-desc">设计稿未提供该分组的样式，尚未实现。</p>
              </div>
            )}
          </div>
        </div>

        <div className="st-foot">
          <Select
            variant="ghost"
            label="模板"
            value="default"
            options={[{ value: 'default', label: '默认模板' }]}
            onChange={() => setDraft({ ...DEFAULT_SETTINGS })}
          />
          <div className="st-foot-spacer" />
          <button type="button" className="al-btn ghost" onClick={() => setDraft({ ...DEFAULT_SETTINGS })}>
            恢复默认
          </button>
          <button type="button" className="al-btn ghost" onClick={close}>
            取消
          </button>
          <button
            type="button"
            className="al-btn solid"
            onClick={() => {
              commit(draft);
              close();
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
