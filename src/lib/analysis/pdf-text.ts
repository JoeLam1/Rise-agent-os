/** Reads page-by-page text from a PDF. Injected in tests. */
export type PdfTextReader = (file: Uint8Array) => Promise<string[]>;

export const readPdfText: PdfTextReader = async (file) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js takes ownership of the buffer, so give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(file));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
};
