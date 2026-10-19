export async function pdfPageImage(file: File, pageNumber: number) {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import(
    "pdfjs-dist/build/pdf.worker.min.mjs?url"
  );
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
    wasmUrl: import.meta.env.DEV
      ? "/node_modules/pdfjs-dist/wasm/"
      : "/pdf/wasm/",
    iccUrl: import.meta.env.DEV
      ? "/node_modules/pdfjs-dist/iccs/"
      : "/pdf/iccs/",
    cMapUrl: import.meta.env.DEV
      ? "/node_modules/pdfjs-dist/cmaps/"
      : "/pdf/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: import.meta.env.DEV
      ? "/node_modules/pdfjs-dist/standard_fonts/"
      : "/pdf/standard_fonts/",
  });
  try {
    const pdf = await loadingTask.promise;
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > pdf.numPages
    )
      throw new Error(`请选择 1 至 ${pdf.numPages} 页。`);
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(2, 1800 / base.width),
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法生成页面图片。");
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      background: "#ffffff",
    }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("页面图片生成失败。"))),
        "image/webp",
        0.9,
      ),
    );
    return {
      file: new File([blob], `pdf-page-${pageNumber}.webp`, {
        type: "image/webp",
      }),
      pages: pdf.numPages,
      url: canvas.toDataURL("image/webp", 0.9),
    };
  } finally {
    await loadingTask.destroy();
  }
}
