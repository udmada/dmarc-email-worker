import { useRef } from "react";

interface FilterBarProps {
  domain?: string;
  from?: string;
  to?: string;
  baseUrl: string;
  showDates?: boolean;
}

export function FilterBar({ domain, from, to, baseUrl, showDates = true }: FilterBarProps) {
  const domainRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const d = domainRef.current?.value.trim();
    if (d != null && d.length > 0) params.set("domain", d);
    if (showDates) {
      const f = fromRef.current?.value;
      const t = toRef.current?.value;
      if (f != null && f.length > 0) params.set("from", f);
      if (t != null && t.length > 0) params.set("to", t);
    }
    const qs = params.toString();
    window.location.assign(qs ? `${baseUrl}?${qs}` : baseUrl);
  };

  const handleClear = () => {
    window.location.assign(baseUrl);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 mb-6 flex-wrap items-center">
      <input
        ref={domainRef}
        type="text"
        defaultValue={domain ?? ""}
        placeholder="Filter by domain…"
        className="h-8 px-3 text-sm rounded-md border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-placeholder focus:outline-2 focus:outline-kumo-brand w-48"
      />
      {showDates && (
        <>
          <input
            ref={fromRef}
            type="date"
            defaultValue={from ?? ""}
            className="h-8 px-3 text-sm rounded-md border border-kumo-line bg-kumo-base text-kumo-default focus:outline-2 focus:outline-kumo-brand"
          />
          <input
            ref={toRef}
            type="date"
            defaultValue={to ?? ""}
            className="h-8 px-3 text-sm rounded-md border border-kumo-line bg-kumo-base text-kumo-default focus:outline-2 focus:outline-kumo-brand"
          />
        </>
      )}
      <button
        type="submit"
        className="h-8 px-3 text-sm rounded-md bg-kumo-brand text-white font-medium hover:opacity-90 transition-opacity cursor-pointer">
        Filter
      </button>
      <button
        type="button"
        onClick={handleClear}
        className="text-sm text-kumo-subtle hover:text-kumo-default transition-colors cursor-pointer">
        Clear
      </button>
    </form>
  );
}
