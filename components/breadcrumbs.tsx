import Link from "next/link";

export type Crumb = {
  label: string;
  href?: string;
};

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="text-sm text-zinc-600">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-x-2">
              {index > 0 ? (
                <span aria-hidden="true" className="text-zinc-400">
                  /
                </span>
              ) : null}
              {item.href && !isLast ? (
                <Link href={item.href} className="underline text-zinc-900">
                  {item.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "font-medium text-zinc-900" : "text-zinc-900"}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
