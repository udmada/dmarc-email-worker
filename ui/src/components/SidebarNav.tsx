import { useLayoutEffect, useRef, useState } from "react";

const STORAGE_KEY = "sidebar-collapsed";

const LINKS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 17.203 14.539"
        fill="currentColor">
        <path d="M15.703 3.172c0 .664-.57 1.242-1.242 1.242-.68 0-1.25-.578-1.25-1.242 0-.656.57-1.242 1.25-1.242.672 0 1.242.586 1.242 1.242M12.71 8.156c0 .664-.57 1.242-1.241 1.242-.68 0-1.25-.578-1.25-1.242 0-.656.57-1.242 1.25-1.242.672 0 1.242.586 1.242 1.242M9.086 4.367c0 .664-.57 1.242-1.242 1.242-.68 0-1.25-.578-1.25-1.242 0-.656.57-1.242 1.25-1.242.672 0 1.242.586 1.242 1.242M6.094 9.36a1.26 1.26 0 0 1-1.242 1.242c-.68 0-1.25-.579-1.25-1.243 0-.656.57-1.242 1.25-1.242s1.242.586 1.242 1.242" />
        <path d="M.625 14.54h15.54a.63.63 0 0 0 .632-.626.634.634 0 0 0-.633-.625H1.477c-.165 0-.22-.055-.22-.219V.72A.63.63 0 0 0 .634.094.634.634 0 0 0 0 .719v13.203c0 .375.25.617.625.617" />
      </svg>
    ),
  },
  {
    href: "/dmarc-reports",
    label: "DMARC Reports",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 18.828 20.383"
        fill="currentColor">
        <path d="m15.281 6.555 2.696 3.343c.351.422.445.774.445 1.485v4.625c0 1.61-.813 2.422-2.453 2.422H2.453C.82 18.43 0 17.617 0 16.008v-4.625c0-.711.102-1.063.445-1.485l2.703-3.343c.914-1.125 1.313-1.47 2.704-1.47h1.273v1.103H5.758c-.57 0-1.008.187-1.39.671l-2.9 3.664c-.132.165-.077.383.18.383h5.149c.406 0 .601.313.601.633v.031c0 .907.711 1.86 1.813 1.86 1.11 0 1.82-.953 1.82-1.86v-.03c0-.321.188-.634.594-.634h5.156c.258 0 .305-.219.18-.383L14.055 6.86c-.383-.484-.82-.671-1.39-.671h-1.368V5.086h1.273c1.39 0 1.797.344 2.711 1.469m-14.023 5.5v3.883c0 .812.43 1.234 1.21 1.234h13.485c.774 0 1.211-.422 1.211-1.235v-3.882h-4.953c-.188 1.453-1.414 2.539-3 2.539s-2.813-1.078-3-2.54Z" />
        <path d="M6.563 3.656c.148 0 .32-.062.43-.187l1.202-1.29 1.016-1.077 1.016 1.078 1.203 1.289a.57.57 0 0 0 .422.187c.328 0 .57-.234.57-.554a.55.55 0 0 0-.18-.407L9.664.211C9.508.055 9.375 0 9.211 0c-.156 0-.297.055-.453.21L6.18 2.696a.55.55 0 0 0-.18.407c0 .32.234.554.563.554m2.648 7c.336 0 .625-.273.625-.601V2.883L9.734.78C9.72.492 9.5.258 9.211.258s-.508.234-.524.523l-.093 2.102v7.172c0 .328.281.601.617.601" />
      </svg>
    ),
  },
  {
    href: "/tls-reports",
    label: "TLS Reports",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 18.828 19.477"
        fill="currentColor">
        <path d="m15.281 6.102 2.696 3.343c.351.422.445.774.445 1.485v4.625c0 1.61-.813 2.422-2.453 2.422H2.453C.82 17.977 0 17.164 0 15.555V10.93c0-.711.102-1.063.445-1.485l2.703-3.343c.914-1.125 1.313-1.47 2.704-1.47h1.273v1.102H5.758c-.57 0-1.008.188-1.39.672l-2.9 3.664c-.132.164-.077.383.18.383h5.149c.406 0 .601.313.601.633v.031c0 .906.711 1.86 1.813 1.86 1.11 0 1.82-.954 1.82-1.86v-.031c0-.32.188-.633.594-.633h5.156c.258 0 .305-.219.18-.383l-2.906-3.664c-.383-.484-.82-.672-1.39-.672h-1.368V4.633h1.273c1.39 0 1.797.344 2.711 1.469m-14.023 5.5v3.882c0 .813.43 1.235 1.21 1.235h13.485c.774 0 1.211-.422 1.211-1.235v-3.882h-4.953c-.188 1.453-1.414 2.539-3 2.539s-2.813-1.078-3-2.54Z" />
        <path d="M6.563 6.79c-.329 0-.563.233-.563.546a.55.55 0 0 0 .18.414l2.578 2.484c.156.157.297.204.453.204.164 0 .297-.047.453-.204l2.578-2.484a.55.55 0 0 0 .18-.414c0-.313-.242-.547-.57-.547a.57.57 0 0 0-.422.188l-1.203 1.289L9.21 9.344 8.195 8.266l-1.203-1.29a.6.6 0 0 0-.43-.187M9.21 0a.62.62 0 0 0-.617.61v6.945l.094 2.11c.015.288.234.523.523.523s.508-.235.523-.524l.102-2.11V.61A.63.63 0 0 0 9.21 0" />
      </svg>
    ),
  },
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
            className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
              current.startsWith(link.href)
                ? "bg-kumo-tint text-kumo-default font-medium"
                : "text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
            }`}>
            <span className="shrink-0">{link.icon}</span>
            {!collapsed && <span>{link.label}</span>}
          </a>
        ))}
      </nav>
    </aside>
  );
}
