import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { parseCsv, readRows } from "./menu-import-parse";

const enc = (s: string) => new TextEncoder().encode(s);
const H = "brand,nama,kategori,harga_app,harga_titip,addons,tersedia\r\n";
// CSV: BOM, kutip, koma dalam sel, CRLF, baris kosong dilewati, nomor baris = baris berkas.
let rows = readRows(enc("\uFEFF" + H + 'fore,"Aren, Latte",Kopi,29000,23200,Suhu|Gula,true\r\n\r\nfore,Croissant,Makanan,32000,,,\r\n'));
assert.equal(rows.length, 2); assert.equal(rows[0].row, 2); assert.equal(rows[0].cells.nama, "Aren, Latte"); assert.equal(rows[1].row, 4);
// titik koma (Excel ID)
assert.equal(readRows(enc("brand;nama;kategori;harga_app\nfore;A;K;1000\n"))[0].cells.nama, "A");
assert.deepEqual(parseCsv('a,"b""c"\n'), [["a", 'b"c']]);
// header wajib, duplikat, kosong, biner, bukan UTF-8
assert.throws(() => readRows(enc("brand,nama\nfore,A\n")), /Kolom wajib/);
assert.throws(() => readRows(enc("brand,brand,nama,kategori,harga_app\n")), /duplikat/);
assert.throws(() => readRows(enc("")), /kosong/);
assert.throws(() => readRows(enc(H)), /Tidak ada baris data/);
assert.throws(() => readRows(new Uint8Array([0x62, 0, 0x61])), /CSV UTF-8/);
assert.throws(() => readRows(new Uint8Array([0xff, 0xfe, 0xfa])), /UTF-8/);
assert.throws(() => parseCsv('a,"b\n'), /kutip/);
// batas baris, sel panjang
assert.throws(() => readRows(enc(H + "fore,A,K,1\n".repeat(1001))), /Maksimal 1000/);
assert.throws(() => readRows(enc(H + `fore,${"x".repeat(501)},K,1\n`)), /melebihi/);
// XLSX valid (shared string, inline string, formula, bool)
const sheet = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="F1" t="s"><v>4</v></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>fore</t></is></c><c r="B2" t="inlineStr"><is><t>Aren &amp; Latte</t></is></c><c r="C2" t="inlineStr"><is><t>Kopi</t></is></c><c r="D2"><v>29000</v></c><c r="F2" t="inlineStr"><is><t>Suhu</t></is></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>fore</t></is></c><c r="B3" t="inlineStr"><is><t>Bad</t></is></c><c r="C3" t="inlineStr"><is><t>K</t></is></c><c r="D3"><f>1+1</f><v>2</v></c></row>
</sheetData></worksheet>`;
const ss = `<sst><si><t>brand</t></si><si><t>nama</t></si><si><t>kategori</t></si><si><t>harga_app</t></si><si><t>addons</t></si></sst>`;
const xlsx = (extra: Record<string, Uint8Array> = {}) => zipSync({
  "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  "xl/sharedStrings.xml": strToU8(ss), "xl/worksheets/sheet1.xml": strToU8(sheet), ...extra,
});
rows = readRows(xlsx());
assert.equal(rows.length, 2); assert.equal(rows[0].cells.nama, "Aren & Latte"); assert.equal(rows[0].cells.harga_app, "29000"); assert.equal(rows[0].cells.addons, "Suhu");
assert.equal(rows[1].cells.harga_app, "=2"); // formula ditandai, nilai cache tidak dipercaya
// makro ditolak; XLSX rusak ditolak; ZIP bomb (>50 MB terdekompresi) ditolak
assert.throws(() => readRows(xlsx({ "xl/vbaProject.bin": strToU8("x") })), /Makro/);
assert.throws(() => readRows(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), /rusak|valid/);
const bomb = zipSync({ "xl/workbook.xml": strToU8("<workbook/>"), "xl/worksheets/sheet1.xml": new Uint8Array(60 * 1024 * 1024) });
assert.ok(bomb.length < 1024 * 1024);
assert.throws(() => readRows(bomb), (e: Error & { status?: number }) => e.status === 413);
console.log("menu-import-parse ok");
