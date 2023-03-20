import { Image } from 'canvas'

export const drawBackground = async (image: Image, background: string) => {
  const backgroundPattern = await Image.renderSVG(background)
  for (
    let xOffset = 0;
    xOffset < image.width;
    xOffset += backgroundPattern.width
  ) {
    for (
      let yOffset = 0;
      yOffset < image.height;
      yOffset += backgroundPattern.height
    ) {
      image.composite(backgroundPattern, xOffset, yOffset)
    }
  }
}
