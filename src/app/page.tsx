import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-5xl font-extrabold tracking-tight">Cemat Cemot</h1>
      <p className="max-w-md text-muted-foreground">
        Next.js + shadcn/ui, soft pastel theme. Ready to build.
      </p>
      <div className="flex gap-3">
        <Button>Get started</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
      </div>
    </main>
  );
}
