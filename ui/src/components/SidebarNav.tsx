import { useLayoutEffect, useRef, useState } from "react";

const STORAGE_KEY = "sidebar-collapsed";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dmarc-reports", label: "DMARC Reports" },
  { href: "/tls-reports", label: "TLS Reports" },
];

export function SidebarNav({ current }: { current: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const firstRender = useRef(true);

  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") setCollapsed(true);
    } catch {}
    firstRender.current = false;
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  return (
    <aside
      className={`${collapsed ? "w-12" : "w-56"} shrink-0 min-h-screen bg-kumo-recessed border-r border-kumo-line flex flex-col overflow-hidden transition-[width] duration-200`}>
      <div className="h-14 border-b border-kumo-line flex items-center shrink-0">
        <button
          onClick={toggle}
          className="shrink-0 w-12 h-14 flex items-center justify-center cursor-pointer hover:bg-kumo-tint text-kumo-subtle select-none text-base"
          title="Toggle sidebar"
          type="button">
          ☰
        </button>
        {!collapsed && (
          <span className="font-semibold text-sm text-kumo-default tracking-tight truncate pr-4">
            DMARC Viewer
          </span>
        )}
      </div>
      <nav className="flex-1 p-2 flex flex-col gap-1">
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            title={link.label}
            className={`flex items-center px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap ${
              current.startsWith(link.href)
                ? "bg-kumo-tint text-kumo-default font-medium"
                : "text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
            }`}>
            {link.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
