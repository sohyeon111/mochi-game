// 작은 DOM 헬퍼
export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Record<string, (e: Event) => void>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.on) for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn);
  for (const c of children) el.append(c);
  return el;
}

export function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  return h('button', { class: cls, text: label, attrs: { type: 'button' }, on: { click: () => onClick() } });
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  el.hidden = hidden;
}
