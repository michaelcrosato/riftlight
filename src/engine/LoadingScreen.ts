/**
 * Minimal pixel-styled loading indicator: a blocky segmented bar and a status word,
 * plain DOM (it shows before the renderer exists). Reuses a `.pixel-loading` element
 * already in the container (index.html ships one so it appears before any JS runs).
 */
export class LoadingScreen {
  readonly root: HTMLElement;
  private readonly cells: HTMLElement[];
  private readonly label: HTMLElement;
  private lit = -1;

  constructor(container: HTMLElement, segments = 12) {
    let root = container.querySelector<HTMLElement>('.pixel-loading');
    if (!root) {
      root = document.createElement('div');
      root.className = 'pixel-loading';
      container.appendChild(root);
    }
    root.innerHTML = `<b>LOADING</b><div class="bar">${'<i></i>'.repeat(segments)}</div>`;
    this.root = root;
    this.label = root.querySelector('b')!;
    this.cells = [...root.querySelectorAll<HTMLElement>('.bar i')];
  }

  /** `progress` 0..1; `label` is shown in capitals. */
  set(progress: number, label?: string): void {
    const lit = Math.round(Math.min(1, Math.max(0, progress)) * this.cells.length);
    if (lit !== this.lit) {
      this.cells.forEach((c, i) => c.classList.toggle('on', i < lit));
      this.lit = lit;
    }
    if (label && this.label.textContent !== label) this.label.textContent = label;
  }

  done(): void {
    this.root.remove();
  }
}
