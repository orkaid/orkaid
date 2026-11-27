// PR-15: publishes the measured block size of the command bar while it is fixed to the viewport (narrow widths), so the
// page footer can clear it in every state (status wrap, open drawer, safe area). 0 when the bar is in the flow.
const bar = document.querySelector<HTMLElement>('#xr-root .bar');
if (bar) {
  const update = () => {
    const fixed = getComputedStyle(bar).position === 'fixed';
    document.documentElement.style.setProperty('--xr-bar-clearance', fixed ? `${Math.ceil(bar.getBoundingClientRect().height)}px` : '0px');
  };
  new ResizeObserver(update).observe(bar);
  addEventListener('resize', update);
  update();
}
