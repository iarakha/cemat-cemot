import type { CatalogBrand } from "@/lib/catalog";
import { rupiah } from "@/lib/pricing";

export function Receipt({ brand, index }: { brand: CatalogBrand; index: number }) {
  const groups = Object.entries(
    brand.items.reduce<Record<string, CatalogBrand["items"]>>((acc, i) => {
      (acc[i.category] ??= []).push(i);
      return acc;
    }, {}),
  );
  const promoCount = brand.items.filter((i) => i.promo).length;
  // Kemiringan bergantian, hanya di layar lebar agar mobile tetap rapi.
  const tilt = ["md:-rotate-[0.8deg]", "md:rotate-[0.6deg]", "md:-rotate-[0.3deg]"][index % 3];

  return (
    <section id={brand.slug} className={`scroll-mt-24 drop-shadow-[0_6px_0_rgb(0_0_0/0.05)] ${tilt}`}>
      <article className="receipt font-receipt text-[13px] leading-6 text-foreground">
        <div className="h-2" style={{ background: brand.accentColor }} aria-hidden />
        <header className="px-5 pt-5 text-center">
          <h2 className="font-cash text-4xl uppercase leading-none tracking-wide">{brand.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {brand.items.length} menu{promoCount > 0 && ` · ${promoCount} promo`}
          </p>
        </header>

        <div className="px-5 pb-8 pt-3">
          {groups.map(([cat, items]) => (
            <div key={cat} className="mt-3">
              <p className="border-y border-dashed border-border py-0.5 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {cat}
              </p>
              <ul className="mt-2 space-y-3">
                {items.map((i) => (
                  <li key={i.id} className="relative">
                    <div className="flex items-end gap-2">
                      <span className="font-bold">{i.name}</span>
                      <span className="mb-1.5 flex-1 border-b border-dotted border-muted-foreground/40" aria-hidden />
                      <span className={`font-cash text-3xl leading-none ${i.promo ? "text-price" : ""}`}>
                        {rupiah(i.promo ? i.promo.final : i.normalPrice)}
                      </span>
                    </div>
                    {i.promo && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="stamp" aria-label={`Hemat ${i.promo.savingPercent} persen`}>Hemat {i.promo.savingPercent}%</span>
                        <span className="ml-auto line-through">{rupiah(i.normalPrice)}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-6 border-t border-dashed border-border pt-2 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            terima kasih · cemat cemot
          </p>
        </div>
      </article>
    </section>
  );
}
