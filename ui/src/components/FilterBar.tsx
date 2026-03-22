import { DatePicker, Popover, Select, type DateRange } from "@cloudflare/kumo";
import { useState } from "react";

interface FilterBarProps {
  domains: string[];
  domain?: string;
  from?: string;
  to?: string;
  baseUrl: string;
}

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null as null },
];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function initRange(from?: string, to?: string): DateRange | undefined {
  if (from == null && to == null) return undefined;
  return {
    from: from != null ? new Date(from) : undefined,
    to: to != null ? new Date(to) : undefined,
  };
}

function detectActivePreset(from?: string, to?: string): number | "all" | null {
  if (from == null && to == null) return "all";
  if (from == null || to == null) return null;
  const diffDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
  if (diffDays === 7) return 7;
  if (diffDays === 30) return 30;
  if (diffDays === 90) return 90;
  return null;
}

function formatRange(range?: DateRange): string {
  if (range?.from == null) return "Custom range";
  const fmt = (d: Date): string =>
    d.toLocaleDateString("en-NZ", { month: "short", day: "numeric" });
  if (range.to == null) return fmt(range.from);
  return `${fmt(range.from)} – ${range.to.toLocaleDateString("en-NZ", { month: "short", day: "numeric", year: "numeric" })}`;
}

export function FilterBar({
  domains,
  domain,
  from,
  to,
  baseUrl,
}: FilterBarProps): React.ReactElement {
  const [range, setRange] = useState<DateRange | undefined>(() => initRange(from, to));
  const activePreset = detectActivePreset(from, to);

  const navigate = (d: string | undefined, f: string | undefined, t: string | undefined): void => {
    const params = new URLSearchParams();
    if (d != null && d.length > 0) params.set("domain", d);
    if (f != null && f.length > 0) params.set("from", f);
    if (t != null && t.length > 0) params.set("to", t);
    const qs = params.toString();
    window.location.assign(qs ? `${baseUrl}?${qs}` : baseUrl);
  };

  const handleDomainChange = (v: string | null | undefined): void => {
    const d = v != null && v.length > 0 ? v : undefined;
    navigate(d, from, to);
  };

  const handlePreset = (days: number | null): void => {
    if (days === null) {
      setRange(undefined);
      navigate(domain, undefined, undefined);
    } else {
      const t = new Date();
      const f = new Date();
      f.setDate(f.getDate() - days);
      setRange({ from: f, to: t });
      navigate(domain, toDateStr(f), toDateStr(t));
    }
  };

  const handleApply = (): void => {
    navigate(
      domain,
      range?.from != null ? toDateStr(range.from) : undefined,
      range?.to != null ? toDateStr(range.to) : undefined,
    );
  };

  return (
    <div className="flex gap-3 mb-6 flex-wrap items-center">
      {/* Domain select */}
      <Select
        value={domain ?? ""}
        onValueChange={handleDomainChange}
        loading={false}
        className="w-48">
        <Select.Option value="">All domains</Select.Option>
        {domains.map((d) => (
          <Select.Option key={d} value={d}>
            {d}
          </Select.Option>
        ))}
      </Select>

      {/* Preset buttons */}
      <div className="flex rounded-md border border-kumo-line overflow-hidden">
        {PRESETS.map((p) => {
          const isActive = p.days === null ? activePreset === "all" : activePreset === p.days;
          return (
            <button
              key={p.label}
              type="button"
              onClick={(): void => {
                handlePreset(p.days);
              }}
              className={`h-8 px-3 text-sm border-r border-kumo-line last:border-r-0 transition-colors cursor-pointer ${
                isActive
                  ? "bg-kumo-brand text-white"
                  : "bg-kumo-base text-kumo-default hover:bg-kumo-tint"
              }`}>
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Date range picker */}
      <Popover>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="h-8 px-3 text-sm rounded-md border border-kumo-line bg-kumo-base text-kumo-default hover:bg-kumo-tint transition-colors cursor-pointer flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 15.977 14.398"
              fill="currentColor">
              <path d="M2.453 14.398h10.672c1.633 0 2.445-.812 2.445-2.421v-9.54c0-1.609-.812-2.421-2.445-2.421H2.453C.82.016 0 .82 0 2.438v9.539c0 1.617.82 2.421 2.453 2.421m-.117-1.257c-.695 0-1.078-.368-1.078-1.094V4.68c0-.72.383-1.094 1.078-1.094h10.89c.696 0 1.086.375 1.086 1.094v7.367c0 .726-.39 1.094-1.085 1.094Zm3.93-6.75h.46c.274 0 .36-.079.36-.352v-.46c0-.274-.086-.36-.36-.36h-.46c-.274 0-.368.086-.368.36v.46c0 .274.094.352.368.352m2.593 0h.461c.274 0 .367-.079.367-.352v-.46c0-.274-.093-.36-.367-.36h-.46c-.274 0-.368.086-.368.36v.46c0 .274.094.352.367.352m2.594 0h.461c.274 0 .367-.079.367-.352v-.46c0-.274-.094-.36-.367-.36h-.46c-.274 0-.36.086-.36.36v.46c0 .274.086.352.36.352M3.672 8.945h.453c.281 0 .367-.078.367-.351v-.461c0-.274-.086-.352-.367-.352h-.453c-.281 0-.367.078-.367.352v.46c0 .274.086.352.367.352m2.594 0h.46c.274 0 .36-.078.36-.351v-.461c0-.274-.086-.352-.36-.352h-.46c-.274 0-.368.078-.368.352v.46c0 .274.094.352.368.352m2.593 0h.461c.274 0 .367-.078.367-.351v-.461c0-.274-.093-.352-.367-.352h-.46c-.274 0-.368.078-.368.352v.46c0 .274.094.352.367.352m2.594 0h.461c.274 0 .367-.078.367-.351v-.461c0-.274-.094-.352-.367-.352h-.46c-.274 0-.36.078-.36.352v.46c0 .274.086.352.36.352m-7.781 2.563h.453c.281 0 .367-.086.367-.36v-.46c0-.274-.086-.352-.367-.352h-.453c-.281 0-.367.078-.367.351v.461c0 .274.086.36.367.36m2.594 0h.46c.274 0 .36-.086.36-.36v-.46c0-.274-.086-.352-.36-.352h-.46c-.274 0-.368.078-.368.351v.461c0 .274.094.36.368.36m2.593 0h.461c.274 0 .367-.086.367-.36v-.46c0-.274-.093-.352-.367-.352h-.46c-.274 0-.368.078-.368.351v.461c0 .274.094.36.367.36" />
            </svg>
            {formatRange(range)}
          </button>
        </Popover.Trigger>
        <Popover.Content className="p-0">
          <div className="flex">
            <div className="flex flex-col gap-1 border-r border-kumo-line p-2">
              {PRESETS.filter((p) => p.days !== null).map((p) => {
                const isActive = activePreset === p.days;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={(): void => {
                      handlePreset(p.days);
                    }}
                    className={`rounded-md px-3 py-1.5 text-sm text-left transition-colors cursor-pointer ${
                      isActive ? "bg-kumo-brand text-white" : "text-kumo-default hover:bg-kumo-tint"
                    }`}>
                    Last {p.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 p-2">
              <DatePicker
                mode="range"
                selected={range}
                onChange={(r): void => {
                  setRange(r);
                }}
                numberOfMonths={2}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleApply}
                  className="h-8 px-4 text-sm rounded-md bg-kumo-brand text-white font-medium hover:opacity-90 transition-opacity cursor-pointer">
                  Apply
                </button>
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover>

      {/* Clear */}
      <button
        type="button"
        onClick={(): void => {
          navigate(undefined, undefined, undefined);
        }}
        className="text-sm text-kumo-subtle hover:text-kumo-default transition-colors cursor-pointer">
        Clear
      </button>
    </div>
  );
}
