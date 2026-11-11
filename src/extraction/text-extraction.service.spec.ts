import { blankPdf, docxWith, pdfWith, SAMPLE_CV } from '../../test/fixtures';
import { TextExtractionService } from './text-extraction.service';

describe('TextExtractionService', () => {
  const service = (limits: Partial<{ maxCvBytes: number; maxCvChars: number }> = {}) =>
    new TextExtractionService({
      get: () => ({ maxCvBytes: 1024 * 1024, maxCvChars: 30000, ...limits }),
    } as never);

  it('reads a PDF', async () => {
    const out = await service().extract(await pdfWith(SAMPLE_CV), 'cv.pdf');
    expect(out.format).toBe('pdf');
    expect(out.text).toContain('Senior payroll accountant');
    expect(out.truncated).toBe(false);
  });

  it('reads a Word document', async () => {
    const out = await service().extract(await docxWith(SAMPLE_CV), 'cv.docx');
    expect(out.format).toBe('docx');
    expect(out.text).toContain('BSc Accounting');
  });

  it('reads plain text', async () => {
    const out = await service().extract(Buffer.from(SAMPLE_CV), 'cv.txt');
    expect(out.format).toBe('text');
  });

  it('goes by the bytes, not the name', async () => {
    const out = await service().extract(await pdfWith(SAMPLE_CV), 'cv.docx');
    expect(out.format).toBe('pdf');
  });

  it('refuses a scanned PDF with no text, rather than screening nothing', async () => {
    await expect(service().extract(await blankPdf(), 'scan.pdf')).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'no_readable_text' }),
    });
  });

  it('refuses a file that is too large', async () => {
    await expect(
      service({ maxCvBytes: 2048 }).extract(Buffer.alloc(4096, 'a'), 'cv.txt'),
    ).rejects.toMatchObject({
      status: 413,
    });
  });

  it('refuses a binary it cannot read', async () => {
    await expect(
      service().extract(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]), 'cv.png'),
    ).rejects.toMatchObject({
      status: 415,
    });
  });

  it('cuts a very long CV to the configured length', async () => {
    const out = service({ maxCvChars: 1000 }).fromText('experience '.repeat(500));
    expect(out.text).toHaveLength(1000);
    expect(out.truncated).toBe(true);
  });
});
