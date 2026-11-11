import JSZip from 'jszip';
import PDFDocument from 'pdfkit';

/** A real PDF with the given text, as a CV upload would be. */
export function pdfWith(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(11).text(text);
    doc.end();
  });
}

/** A PDF with no text layer — what a scanned CV looks like to a parser. */
export function blankPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.rect(50, 50, 200, 200).fill('#cccccc');
    doc.end();
  });
}

/** A minimal but valid .docx holding one paragraph per line. */
export async function docxWith(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  const paragraphs = text
    .split('\n')
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${paragraphs}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const SAMPLE_CV = [
  'Adaeze Okafor',
  'Lagos, Nigeria · +234 803 123 4567',
  'Senior payroll accountant with 7 years of experience running monthly payroll for 800 staff.',
  'Skills: PAYE, pension remittance, Excel, reconciliation, Sage.',
  'Education: BSc Accounting, University of Lagos.',
].join('\n');

export const POSTING = {
  title: 'Payroll Accountant',
  description: 'Run monthly payroll and statutory remittances.',
  requirements: 'payroll, PAYE, pension, reconciliation, Excel',
  location: 'Lagos',
  workMode: 'hybrid',
  department: 'Finance',
};
