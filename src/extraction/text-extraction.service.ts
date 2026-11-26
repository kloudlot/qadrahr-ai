import {
  Injectable,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mammoth from 'mammoth';
import { AppConfig } from '../config/configuration';

import { PDFParse } from 'pdf-parse';

export interface ExtractedText {
  text: string;
  /** True when the document was longer than the model will be shown. */
  truncated: boolean;
  format: 'pdf' | 'docx' | 'text';
}

/** What is being read: a candidate's CV, or an organisation's document. */
export type ExtractionKind = 'cv' | 'document';

const PDF = /^%PDF-/;
/** DOCX is a zip; the first bytes are the zip signature. */
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * CV text from the file's bytes.
 *
 * The format is read from the bytes, not trusted from the name or the
 * declared type — a file called cv.pdf that is really something else is
 * refused rather than handed to a parser that expects a PDF.
 */
@Injectable()
export class TextExtractionService {
  private readonly limits: AppConfig['limits'];

  constructor(config: ConfigService<AppConfig, true>) {
    this.limits = config.get('limits', { infer: true });
  }

  /**
   * `kind` sets the limits and the words in errors: a CV is short and cut
   * at the CV limit; a document (a policy, a handbook) may run to hundreds
   * of pages and has its own.
   */
  async extract(
    buffer: Buffer,
    filename = '',
    kind: ExtractionKind = 'cv',
  ): Promise<ExtractedText> {
    const { noun, maxBytes } = this.rules(kind);
    if (buffer.length === 0) throw new UnprocessableEntityException(`The ${noun} file is empty`);
    if (buffer.length > maxBytes) {
      throw new PayloadTooLargeException(
        `The ${noun} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`,
      );
    }

    let text: string;
    let format: ExtractedText['format'];

    if (PDF.test(buffer.subarray(0, 5).toString('latin1'))) {
      format = 'pdf';
      try {
        text = await pdfText(buffer);
      } catch {
        throw new UnprocessableEntityException(
          'The PDF could not be read — it may be damaged or password-protected',
        );
      }
    } else if (buffer.subarray(0, 4).equals(ZIP)) {
      format = 'docx';
      try {
        text = (await mammoth.extractRawText({ buffer })).value;
      } catch {
        throw new UnprocessableEntityException(
          'The Word document could not be read. Only .docx is supported',
        );
      }
    } else if (/\.(txt|md)$/i.test(filename) || isPlainText(buffer)) {
      format = 'text';
      text = buffer.toString('utf8');
    } else {
      throw new UnsupportedMediaTypeException(
        `${noun === 'CV' ? 'CVs' : 'Documents'} must be PDF, Word (.docx) or plain text`,
      );
    }

    return this.fromText(text, format, kind);
  }

  /** Text the backend already has — a cover letter — held to the same rules. */
  fromText(
    raw: string,
    format: ExtractedText['format'] = 'text',
    kind: ExtractionKind = 'cv',
  ): ExtractedText {
    const { noun, maxChars } = this.rules(kind);
    const text = raw
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // A scanned CV is a picture of text. Screening an empty document would
    // score the candidate on nothing and reject them for it.
    if (text.replace(/\s/g, '').length < 50) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'no_readable_text',
        message: `No readable text was found — the ${noun} may be a scanned image`,
      });
    }

    const truncated = text.length > maxChars;
    return { text: truncated ? text.slice(0, maxChars) : text, truncated, format };
  }

  private rules(kind: ExtractionKind) {
    return kind === 'cv'
      ? { noun: 'CV', maxBytes: this.limits.maxCvBytes, maxChars: this.limits.maxCvChars }
      : {
          noun: 'document',
          maxBytes: this.limits.maxDocumentBytes,
          maxChars: this.limits.maxDocumentChars,
        };
  }
}

function isPlainText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 2048);
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return control / Math.max(sample.length, 1) < 0.05;
}

/** The text layer of every page, on the maintained pdf.js. */
async function pdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    // Drop the "-- 1 of 2 --" markers it puts between pages.
    return text.replace(/^-- \d+ of \d+ --$/gm, '');
  } finally {
    await parser.destroy();
  }
}
