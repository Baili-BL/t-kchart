import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { useToast } from '../ui/toast';
import { useChartStore } from '../store/chartStore';
import { useStudyStore } from '../store/studyStore';
import { SORTED_INDICATORS, inputDefsOf, indicatorById, searchIndicators } from '../indicators';
import type { IndicatorDef, IndicatorKind } from '../indicators';
import { SOURCE_NAMES } from '../engine/pine';
import type { StudyInputDef } from '../engine/studies';

type SectionKey = 'fav' | 'mine' | 'bought' | 'tech' | 'fund' | 'editor' | 'hot' | 'popular' | 'market';

interface Section {
  key: SectionKey;
  label: string;
  icon: IconName;
  /** 这个分区目前没有内容时给用户的解释 */
  empty?: string;
}

const GROUPS: { title: string; items: Section[] }[] = [
  {
    title: '个人',
    items: [
      { key: 'fav', label: '收藏', icon: 'star', empty: '还没有收藏。把鼠标移到指标上，点右侧的星标即可收藏。' },
      { key: 'mine', label: '我的脚本', icon: 'user', empty: '暂无自己的脚本。可以在 Agent 面板里让它「运行 Pine」，脚本编辑器会在后续版本提供。' },
      { key: 'bought', label: '已购买', icon: 'wallet', empty: '没有已购买的指标。' },
    ],
  },
  {
    title: '内置',
    items: [
      { key: 'tech', label: '技术指标', icon: 'pulse' },
      { key: 'fund', label: '基本面', icon: 'barsChart', empty: '基本面数据（财报、估值等）尚未接入。' },
    ],
  },
  {
    title: '社区',
    items: [
      { key: 'editor', label: '编辑精选', icon: 'bookmarkOutline', empty: '社区内容尚未接入。' },
      { key: 'hot', label: '最热', icon: 'trend', empty: '社区内容尚未接入。' },
      { key: 'popular', label: '热门', icon: 'flame', empty: '社区内容尚未接入。' },
      { key: 'market', label: '市场', icon: 'bag', empty: '社区内容尚未接入。' },
    ],
  },
];

const PILLS: { key: IndicatorKind; label: string }[] = [
  { key: 'indicator', label: '指标' },
  { key: 'strategy', label: '策略' },
  { key: 'profile', label: '简介' },
  { key: 'pattern', label: '形态' },
  { key: 'option', label: 'Options' },
];

const PILL_EMPTY: { [k: string]: string } = {
  strategy: '策略脚本（带回测）还没有放进内置库。策略回测请用 Agent 的「运行 Pine」。',
  profile: '成交量分布 / 简介类脚本尚未提供。',
  pattern: '形态识别脚本尚未提供。',
  option: '期权相关脚本尚未提供。',
};

/** 指标、衡量标准和策略：搜索 + 分区 + 列表。点一行 = 加到图上（所有格），对话框保持打开方便连续添加 */
export function IndicatorDialog(): JSX.Element | null {
  const open = useStudyStore((s) => s.dialogOpen);
  const close = useStudyStore((s) => s.closeDialog);
  const studies = useStudyStore((s) => s.studies);
  const favorites = useStudyStore((s) => s.favorites);
  const toggleFav = useStudyStore((s) => s.toggleFavorite);
  const addIndicator = useStudyStore((s) => s.addIndicator);
  const removeStudy = useStudyStore((s) => s.removeStudy);
  const edit = useStudyStore((s) => s.edit);
  const bbVisible = useChartStore((s) => s.bbVisible);
  const setBb = useChartStore((s) => s.setBb);
  const toast = useToast((s) => s.show);

  const [q, setQ] = useState('');
  const [section, setSection] = useState<SectionKey>('tech');
  const [pill, setPill] = useState<IndicatorKind>('indicator');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !useStudyStore.getState().editingUid) close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of studies) if (s.indicatorId) m.set(s.indicatorId, (m.get(s.indicatorId) ?? 0) + 1);
    return m;
  }, [studies]);

  const sec = GROUPS.flatMap((g) => g.items).find((x) => x.key === section) as Section;
  const searching = q.trim() !== '';

  const list: IndicatorDef[] = useMemo(() => {
    if (pill !== 'indicator') return [];
    if (searching) return searchIndicators(q).filter((d) => d.kind === 'indicator');
    if (section === 'tech') return SORTED_INDICATORS.filter((d) => d.kind === 'indicator');
    if (section === 'fav') return SORTED_INDICATORS.filter((d) => favorites.includes(d.id));
    return [];
  }, [pill, section, q, searching, favorites]);

  if (!open) return null;

  const emptyText = searching
    ? `没有找到「${q.trim()}」相关的指标`
    : pill !== 'indicator'
      ? PILL_EMPTY[pill]
      : sec.empty ?? '这里还没有内容';

  const add = (d: IndicatorDef): void => {
    const r = addIndicator(d.id);
    toast(r.ok ? `已添加「${d.name}」` : r.message);
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="ind-dialog" role="dialog" aria-modal="true" aria-label="指标、衡量标准和策略">
        <div className="ind-head">
          <h2>指标、衡量标准和策略</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="ind-search">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            value={q}
            placeholder="搜索"
            aria-label="搜索指标"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="ind-body">
          <nav className="ind-side" aria-label="指标分区">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div className="ind-side-title">{g.title}</div>
                {g.items.map((it) => (
                  <button
                    type="button"
                    key={it.key}
                    className={'ind-side-item' + (!searching && section === it.key ? ' sel' : '')}
                    aria-current={!searching && section === it.key ? 'page' : undefined}
                    onClick={() => {
                      setSection(it.key);
                      setQ('');
                    }}
                  >
                    <Icon name={it.icon} size={18} />
                    <span>{it.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <section className="ind-main">
            <div className="ind-pills" role="tablist">
              {PILLS.map((p) => (
                <button
                  type="button"
                  key={p.key}
                  role="tab"
                  aria-selected={pill === p.key}
                  className={'ind-pill' + (pill === p.key ? ' sel' : '')}
                  onClick={() => setPill(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="ind-colhead">脚本名称</div>
            {list.length === 0 ? (
              <div className="ind-empty">{emptyText}</div>
            ) : (
              <ul className="ind-list" aria-label="脚本列表">
                {list.map((d) => {
                  const n = counts.get(d.id) ?? 0;
                  const fav = favorites.includes(d.id);
                  const off = !d.source;
                  return (
                    <li key={d.id}>
                      <div
                        className={'ind-row' + (off ? ' off' : '')}
                        data-id={d.id}
                        role="button"
                        tabIndex={0}
                        title={off ? `暂不可用：${d.unsupported}` : d.description}
                        onClick={() => (off ? toast(`「${d.name}」暂不可用：${d.unsupported}`) : add(d))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (off) toast(`「${d.name}」暂不可用：${d.unsupported}`);
                            else add(d);
                          }
                        }}
                      >
                        <span className="ind-name">{d.name}</span>
                        {d.beta && <span className="ind-beta">BETA</span>}
                        {off && <span className="ind-off">不可用</span>}
                        <span className="ind-spacer" />
                        {n > 0 && <span className="ind-count">已添加{n > 1 ? ` ×${n}` : ''}</span>}
                        <button
                          type="button"
                          className={'ind-star' + (fav ? ' on' : '')}
                          aria-label={(fav ? '取消收藏 ' : '收藏 ') + d.name}
                          aria-pressed={fav}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFav(d.id);
                          }}
                        >
                          <Icon name="star" size={16} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="ind-added" aria-label="已添加的指标">
          <span className="ind-added-title">图上的指标</span>
          <button
            type="button"
            className={'ind-chip' + (bbVisible ? ' on' : '')}
            aria-pressed={bbVisible}
            title="主图自带的布林带通道（BB 20, 2）"
            onClick={() => setBb(!bbVisible)}
          >
            布林带（内置）
          </button>
          {studies.map((s) => (
            <span className="ind-chip on" key={s.uid} data-uid={s.uid}>
              <button type="button" className="ind-chip-name" title="改参数" onClick={() => edit(s.uid)}>
                {s.name}
              </button>
              <button type="button" className="ind-chip-x" aria-label={`移除 ${s.name}`} onClick={() => removeStudy(s.uid)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          {studies.length === 0 && <span className="ind-added-none">还没有添加脚本指标</span>}
        </div>
      </div>
    </div>
  );
}

/* ===========================================================================
 * 指标参数（图例上点 ⚙ 或已添加条上点名字）
 * ========================================================================= */

function FieldInput({ d, value, onChange }: { d: StudyInputDef; value: any; onChange: (v: any) => void }): JSX.Element {
  if (d.kind === 'bool') {
    return <input type="checkbox" checked={!!value} aria-label={d.title} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (d.kind === 'source') {
    return (
      <select value={String(value)} aria-label={d.title} onChange={(e) => onChange(e.target.value)}>
        {SOURCE_NAMES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    );
  }
  if (d.kind === 'int' || d.kind === 'float' || d.kind === 'price') {
    return (
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={d.min}
        max={d.max}
        step={d.step ?? (d.kind === 'int' ? 1 : 'any')}
        aria-label={d.title}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      />
    );
  }
  return <input type="text" value={String(value ?? '')} aria-label={d.title} onChange={(e) => onChange(e.target.value)} />;
}

export function StudySettingsDialog(): JSX.Element | null {
  const uid = useStudyStore((s) => s.editingUid);
  const study = useStudyStore((s) => s.studies.find((x) => x.uid === uid) ?? null);
  const edit = useStudyStore((s) => s.edit);
  const setInputs = useStudyStore((s) => s.setInputs);
  const defs = useMemo(() => {
    if (!study) return [] as StudyInputDef[];
    try {
      return inputDefsOf(study.source);
    } catch (_e) {
      return [] as StudyInputDef[];
    }
  }, [study]);
  const [vals, setVals] = useState<{ [k: string]: any }>({});

  useEffect(() => {
    if (!study) return;
    const v: { [k: string]: any } = {};
    for (const d of defs) v[d.title] = d.title in study.inputs ? study.inputs[d.title] : d.def;
    setVals(v);
  }, [study, defs]);

  if (!study) return null;
  const close = (): void => edit(null);
  const indicator = study.indicatorId ? indicatorById(study.indicatorId) : null;

  const apply = (): void => {
    const out: { [k: string]: any } = {};
    for (const d of defs) {
      let v = vals[d.title];
      if (d.kind === 'int' || d.kind === 'float' || d.kind === 'price') {
        if (!Number.isFinite(v)) v = d.def;
        if (d.kind === 'int') v = Math.round(v);
        if (d.min !== undefined && v < d.min) v = d.min;
        if (d.max !== undefined && v > d.max) v = d.max;
      }
      out[d.title] = v;
    }
    setInputs(study.uid, out);
    close();
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="study-settings" role="dialog" aria-modal="true" aria-label={`${study.name} 设置`}>
        <div className="ind-head">
          <h2>{study.name}</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {indicator && <p className="study-desc">{indicator.description}</p>}
        <div className="study-fields">
          {defs.length === 0 && <div className="ind-empty">这个指标没有可调参数</div>}
          {defs.map((d) => (
            <label key={d.title} className="study-field">
              <span>{d.title}</span>
              <FieldInput d={d} value={vals[d.title]} onChange={(v) => setVals((o) => ({ ...o, [d.title]: v }))} />
            </label>
          ))}
        </div>
        <div className="study-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              const v: { [k: string]: any } = {};
              for (const d of defs) v[d.title] = d.def;
              setVals(v);
            }}
          >
            恢复默认
          </button>
          <span className="ind-spacer" />
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
