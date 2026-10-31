import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { saveImage, removeStored } from "../src/server/files";

async function main() {
  const dir = await mkdtemp(path.join(process.env.TMPDIR!, "cc-upload-test-"));
  process.env.UPLOAD_DIR = dir;
  try {
    const forged = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "fake.png");
    await assert.rejects(saveImage(forged, "payment-proofs"), (e: unknown) => (e as {status:number}).status === 415);
    const sharp = (await import("sharp")).default;
    const png = await sharp({create:{width:1,height:1,channels:3,background:"#ffffff"}}).png().toBuffer();
    const rel = await saveImage(new File([new Uint8Array(png)], "real.png"), "payment-proofs");
    assert.match(rel, /^payment-proofs\/[a-f0-9]{32}\.png$/);
    await removeStored(rel);
    console.log("upload decode checks passed");
  } finally { await rm(dir, {recursive:true,force:true}); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
