const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function toDataUrl(imagePath) {
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mime = ext === 'svg' ? 'image/svg+xml' : 'image/png';
  const buffer = fs.readFileSync(imagePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function renderPdfPagesToImages(filepath, outputDir, { scale = 1.4, maxPages = null } = {}) {
  const data = new Uint8Array(fs.readFileSync(filepath));
  const pdfDocument = await pdfjsLib.getDocument({ data }).promise;
  const pageCount = pdfDocument.numPages;
  const totalPages = maxPages ? Math.min(pageCount, maxPages) : pageCount;

  await fs.promises.mkdir(outputDir, { recursive: true });

  const rendered = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const operatorList = await page.getOperatorList();
    const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs);
    const svg = await svgGfx.getSVG(operatorList, viewport);

    const imageFilename = `page-${pageNumber}.svg`;
    const imagePath = path.join(outputDir, imageFilename);
    await fs.promises.writeFile(imagePath, svg.toString());
    rendered.push({ pageNumber, imagePath });
  }

  return rendered;
}

async function runOcrOnImages(images, { model = 'gpt-4o-mini' } = {}) {
  const results = new Map();

  for (const image of images) {
    const dataUrl = toDataUrl(image.imagePath);
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract any readable text from this drawing. Return plain text only.' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ],
      temperature: 0,
      max_tokens: 600
    });

    const text = response.choices[0].message.content;
    results.set(image.pageNumber, text ? text.trim() : '');
  }

  return results;
}

module.exports = {
  renderPdfPagesToImages,
  runOcrOnImages
};
