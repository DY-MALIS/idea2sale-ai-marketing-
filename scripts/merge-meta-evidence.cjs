const fs = require('fs');
const path = require('path');

const sourcePath = 'C:\\Users\\PC\\Downloads\\TI26-01681_$782.00_DGACADEMY.pdf';
const leasePath = 'C:\\Users\\PC\\Downloads\\photo_2026-10-30_16-17-46.jpg';
const outputPath = path.resolve('output/pdf/DGACADEMY-hotel-invoice-and-office-lease-evidence.pdf');

const source = fs.readFileSync(sourcePath);
const lease = fs.readFileSync(leasePath);
if (source.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Source is not a PDF');
if (lease[0] !== 0xff || lease[1] !== 0xd8) throw new Error('Lease image is not a JPEG');

// The original two-page PDF uses a conventional xref table. Keep all of its
// bytes intact, then append one new page in an incremental PDF update.
const sourceText = source.toString('latin1');
const previousXref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(sourceText);
if (!previousXref) throw new Error('Source PDF has no conventional startxref');
if (!/3 0 obj\s*<<\/Count 2\/Kids\[10 0 R 14 0 R\]\/Type\/Pages>>/.test(sourceText)) {
  throw new Error('Source page tree differs from the reviewed PDF');
}

function jpegDimensions(bytes) {
  let position = 2;
  while (position < bytes.length) {
    if (bytes[position++] !== 0xff) continue;
    let marker = bytes[position++];
    while (marker === 0xff) marker = bytes[position++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const length = bytes.readUInt16BE(position);
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      return {
        height: bytes.readUInt16BE(position + 3),
        width: bytes.readUInt16BE(position + 5),
        components: bytes[position + 7],
      };
    }
    position += length;
  }
  throw new Error('Cannot read JPEG dimensions');
}

const dimensions = jpegDimensions(lease);
if (dimensions.components !== 3) throw new Error('Expected a three-channel color JPEG');
const pageWidth = 595.2;
const pageHeight = 841.68;
const margin = 15;
const scale = Math.min((pageWidth - margin * 2) / dimensions.width, (pageHeight - margin * 2) / dimensions.height);
const drawWidth = +(dimensions.width * scale).toFixed(3);
const drawHeight = +(dimensions.height * scale).toFixed(3);
const drawX = +((pageWidth - drawWidth) / 2).toFixed(3);
const drawY = +((pageHeight - drawHeight) / 2).toFixed(3);
const content = Buffer.from(`q\n${drawWidth} 0 0 ${drawHeight} ${drawX} ${drawY} cm\n/LeasePhoto Do\nQ\n`, 'ascii');

const parts = [source, Buffer.from('\n', 'ascii')];
let offset = source.length + 1;
const objectOffsets = {};
function addObject(number, chunks) {
  objectOffsets[number] = offset;
  const object = Buffer.concat([
    Buffer.from(`${number} 0 obj\n`, 'ascii'),
    ...chunks,
    Buffer.from('\nendobj\n', 'ascii'),
  ]);
  parts.push(object);
  offset += object.length;
}

addObject(3, [Buffer.from('<</Count 3/Kids[10 0 R 14 0 R 30 0 R]/Type/Pages>>', 'ascii')]);
addObject(28, [
  Buffer.from(`<</Type/XObject/Subtype/Image/Width ${dimensions.width}/Height ${dimensions.height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${lease.length}>>\nstream\n`, 'ascii'),
  lease,
  Buffer.from('\nendstream', 'ascii'),
]);
addObject(29, [
  Buffer.from(`<</Length ${content.length}>>\nstream\n`, 'ascii'),
  content,
  Buffer.from('endstream', 'ascii'),
]);
addObject(30, [Buffer.from(`<</Type/Page/Parent 3 0 R/MediaBox[0 0 ${pageWidth} ${pageHeight}]/Resources<</XObject<</LeasePhoto 28 0 R>>>>/Contents 29 0 R>>`, 'ascii')]);

const xrefOffset = offset;
function row(number) { return `${String(objectOffsets[number]).padStart(10, '0')} 00000 n \n`; }
const xref = `xref\n3 1\n${row(3)}28 3\n${row(28)}${row(29)}${row(30)}trailer\n<</Size 31/Root 2 0 R/Info 1 0 R/Prev ${previousXref[1]}>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
parts.push(Buffer.from(xref, 'ascii'));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.concat(parts));
console.log(JSON.stringify({ outputPath, pageCount: 3, leaseDimensions: dimensions, bytes: fs.statSync(outputPath).size }));
