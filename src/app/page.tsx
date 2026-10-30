import { Suspense } from "react";
import { Receipt } from "@/components/receipt";
import { getCatalog } from "@/lib/catalog";

async function Catalog() {
  const brands = await getCatalog();
  return (
    <>
      <nav aria-label="Brand" className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-background/90 px-4 py-3 backdrop-blur-sm">
        {brands.map((b) => (
          <a
            key={b.id}
            href={`#${b.slug}`}
            className="shrink-0 rounded-full border border-border bg-card px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-secondary"
          >
            {b.name}
          </a>
        ))}
      </nav>
      <div className="mt-6 grid items-start gap-10 md:grid-cols-2 xl:grid-cols-3">
        {brands.map((b, i) => (
          <Receipt key={b.id} brand={b} index={i} />
        ))}
      </div>
    </>
  );
}

function CatalogSkeleton() {
  return (
    <div className="mt-16 grid gap-10 md:grid-cols-2 xl:grid-cols-3" aria-busy>
      {[0, 1, 2].map((n) => (
        <div key={n} className="receipt h-96 animate-pulse opacity-60" />
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-10">
      <header className="max-w-xl">
        <h1 className="font-cash text-6xl leading-none sm:text-7xl">
          Cemat <span className="text-primary">Cemot</span>
        </h1>
        <p className="mt-3 text-muted-foreground">
          Titip beli kopi, tinggal ambil di outlet. Pilih menu, bayar QRIS, kami yang antre.
        </p>
      </header>
      <Suspense fallback={<CatalogSkeleton />}>
        <Catalog />
      </Suspense>
    </main>
  );
}
