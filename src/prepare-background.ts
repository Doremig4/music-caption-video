// calculateMetadata runs once before rendering. Bake the same Chromium blur
// into a PNG so every video frame only needs to draw an ordinary image.
export const prepareBackground = async (response: Response) => {
  const image = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('배경 이미지를 준비할 수 없습니다.');
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.filter = 'blur(30px)';
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    image.close();
  }
};
