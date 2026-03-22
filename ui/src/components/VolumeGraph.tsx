import "d3-transition";

import { extent, max } from "d3-array";
import { easeCubic } from "d3-ease";
import { scaleLinear, scaleTime } from "d3-scale";
import { select } from "d3-selection";
import { area, line } from "d3-shape";
import { useCallback, useEffect, useRef, useState } from "react";

export interface DayPoint {
  day: string;
  total: number;
}

const PAD_TOP = 20;
const PAD_BOTTOM = 32;
const PAD_LEFT = 0;

function fmt(date: Date): string {
  return date.toLocaleDateString("en-NZ", { month: "short", day: "numeric" });
}

export function VolumeGraph({ data }: { data: DayPoint[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    date: string;
    total: number;
  }>({ visible: false, x: 0, date: "", total: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ width, height });
    });
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
    };
  }, []);

  const points = data.map((d) => ({ x: new Date(d.day), y: d.total }));

  const draw = useCallback(
    (transition: number) => {
      if (!svgRef.current || !dims || points.length < 2) return;
      const { width, height } = dims;
      const [minX, maxX] = extent(points, (d) => d.x) as [Date, Date];
      const maxY = max(points, (d) => d.y) ?? 0;
      const xScale = scaleTime([minX, maxX], [PAD_LEFT, width]);
      const yScale = scaleLinear([0, Math.max(maxY * 1.25, 1)], [height - PAD_BOTTOM, PAD_TOP]);

      const areaFn = area<(typeof points)[0]>()
        .x((d) => xScale(d.x))
        .y0(yScale(0))
        .y1((d) => yScale(d.y));
      const lineFn = line<(typeof points)[0]>()
        .x((d) => xScale(d.x))
        .y((d) => yScale(d.y));

      const svg = select(svgRef.current);
      svg
        .selectChild<SVGPathElement>("#vol-area")
        .transition()
        .ease(easeCubic)
        .duration(transition)
        .attr("d", areaFn(points) ?? "");
      svg
        .selectChild<SVGPathElement>("#vol-line")
        .transition()
        .ease(easeCubic)
        .duration(transition)
        .attr("d", lineFn(points) ?? "");

      // x-axis tick labels
      const tickCount = width < 500 ? 4 : 6;
      let ticks = xScale.ticks(tickCount);
      if (xScale(ticks[0]) < 30) ticks = ticks.slice(1);
      if (xScale(ticks[ticks.length - 1]) > width - 30) ticks = ticks.slice(0, -1);
      svg.selectChild<SVGGElement>("#vol-xaxis").call((g) => {
        g.attr("transform", `translate(0,${height - PAD_BOTTOM + 14})`);
        g.selectAll("text").remove();
        for (const t of ticks) {
          g.append("text")
            .attr("x", xScale(t))
            .attr("text-anchor", "middle")
            .attr("fill", "var(--text-color-kumo-inactive)")
            .attr("font-size", "11")
            .text(fmt(t));
        }
      });
    },
    [dims, points],
  );

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current && dims) {
      firstRender.current = false;
      draw(0);
    }
  }, [dims, draw]);
  useEffect(() => {
    if (!firstRender.current) draw(400);
  }, [draw]);

  // Mouse interaction
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !dims || points.length < 2) return;
    const { width, height } = dims;
    const [minX, maxX] = extent(points, (d) => d.x) as [Date, Date];
    const xScale = scaleTime([minX, maxX], [PAD_LEFT, width]);

    const onMove = (e: MouseEvent) => {
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const step = (width - PAD_LEFT) / (points.length - 1);
      const idx = Math.min(Math.max(Math.round((mx - PAD_LEFT) / step), 0), points.length - 1);
      const pt = points[idx];
      const nx = xScale(pt.x);
      select(svg)
        .selectChild<SVGPathElement>("#vol-needle")
        .attr("d", `M${nx},${PAD_TOP} L${nx},${height - PAD_BOTTOM}`);
      setTooltip({ visible: true, x: nx, date: fmt(pt.x), total: pt.y });
    };
    const onLeave = () => {
      select(svg).selectChild<SVGPathElement>("#vol-needle").attr("d", "");
      setTooltip((t) => ({ ...t, visible: false }));
    };
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", onLeave);
    return () => {
      svg.removeEventListener("mousemove", onMove);
      svg.removeEventListener("mouseleave", onLeave);
    };
  }, [dims, points]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-kumo-inactive">
        No data for the past 30 days
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative" style={{ height: "180px" }}>
      {tooltip.visible && (
        <div
          className="absolute top-0 text-xs text-kumo-subtle pointer-events-none"
          style={{ left: `${Math.min(tooltip.x + 8, (dims?.width ?? 300) - 120)}px` }}>
          <span className="font-medium text-kumo-default">{tooltip.total.toLocaleString()}</span>
          {" emails · "}
          {tooltip.date}
        </div>
      )}
      <svg ref={svgRef} style={{ display: "block", width: "100%", height: "100%" }}>
        <defs>
          <linearGradient id="volGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-kumo-brand)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-kumo-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path id="vol-area" fill="url(#volGrad)" stroke="none" />
        <path id="vol-line" fill="none" stroke="var(--color-kumo-brand)" strokeWidth="2" />
        <path
          id="vol-needle"
          fill="none"
          stroke="var(--color-kumo-line)"
          strokeWidth="1"
          strokeDasharray="4,3"
        />
        <g id="vol-xaxis" />
      </svg>
    </div>
  );
}
