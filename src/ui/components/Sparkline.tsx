import { useMemo, useRef, useState } from 'react';

/**
 * Minimal line chart for trends: 1.5 px line, 10 % area wash, end marker with a surface ring,
 * hover readout. Scales to its container width.
 */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  color,
  min,
  max,
  area = true,
  format,
  label,
}: {
  values: ArrayLike<number>;
  width?: number;
  height?: number;
  color?: string;
  min?: number;
  max?: number;
  area?: boolean;
  format?: (v: number) => string;
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const geom = useMemo(() => {
    const n = values.length;
    if (n < 2) return null;
    let lo = min ?? Infinity;
    let hi = max ?? -Infinity;
    if (min === undefined || max === undefined) {
      for (let i = 0; i < n; i++) {
        const v = values[i]!;
        if (min === undefined && v < lo) lo = v;
        if (max === undefined && v > hi) hi = v;
      }
    }
    if (hi - lo < 1e-9) {
      hi += 1;
      lo -= 1;
    }
    const pad = 2;
    const x = (i: number) => (i / (n - 1)) * width;
    const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);
    let d = '';
    for (let i = 0; i < n; i++) d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(values[i]!).toFixed(1)}`;
    const areaD = `${d}L${width},${height}L0,${height}Z`;
    return { d, areaD, x, y, n };
  }, [values, width, height, min, max]);

  if (!geom) {
    return <svg className="sf-sparkline" width={width} height={height} aria-hidden />;
  }
  const last = values[geom.n - 1]!;
  const hv = hover !== null ? values[hover]! : null;
  return (
    <svg
      ref={svgRef}
      className="sf-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={color ? { ['--spark-color' as string]: color } : undefined}
      role="img"
      aria-label={label ? `${label}: ${format ? format(last) : last}` : undefined}
      onMouseMove={(e) => {
        const r = svgRef.current!.getBoundingClientRect();
        const i = Math.round(((e.clientX - r.left) / r.width) * (geom.n - 1));
        setHover(Math.max(0, Math.min(geom.n - 1, i)));
      }}
      onMouseLeave={() => setHover(null)}
    >
      {area && <path className="sf-sparkline__area" d={geom.areaD} />}
      <path className="sf-sparkline__line" d={geom.d} />
      {hover === null ? (
        <circle className="sf-sparkline__end" cx={width} cy={geom.y(last)} r={3} />
      ) : (
        <>
          <line x1={geom.x(hover)} x2={geom.x(hover)} y1={0} y2={height} stroke="var(--line-3)" strokeWidth={1} />
          <circle className="sf-sparkline__end" cx={geom.x(hover)} cy={geom.y(hv!)} r={3} />
          {format && (
            <text
              x={Math.min(width - 2, Math.max(2, geom.x(hover)))}
              y={-4}
              textAnchor={geom.x(hover) > width / 2 ? 'end' : 'start'}
              fill="var(--text-2)"
              fontSize={10}
            >
              {format(hv!)}
            </text>
          )}
        </>
      )}
    </svg>
  );
}
