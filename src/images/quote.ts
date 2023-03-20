import { Image, TextLayout } from 'canvas'
import { drawBackground } from './utils/draw-background.ts'

const backgroundSVG = await Deno.readFile('./assets/images/background.svg')
  .then((b) => new TextDecoder().decode(b))

const phraseFont = await Deno.readFile('./assets/fonts/OpenSans-Regular.ttf')
const mentionFont = await Deno.readFile('./assets/fonts/OpenSans-Medium.ttf')

const AVATAR_SIZE = 128
const AVATAR_BORDER = 10
const PADDING = 52
const IMAGE_WIDTH = 1000

export const drawAvatar = async (image: Image, avatar: Uint8Array) => {
  const avatarBG = new Image(
    AVATAR_SIZE + AVATAR_BORDER,
    AVATAR_SIZE + AVATAR_BORDER,
  )
  const avatarGradient = Image.gradient({ 0: 0x00ffffff, 1: 0x0080ffff })
  avatarBG.fill((x, y) =>
    avatarGradient((x + y) / (avatarBG.width + avatarBG.height))
  )
  image.composite(
    avatarBG.cropCircle(),
    PADDING,
    image.height - (AVATAR_SIZE + AVATAR_BORDER) - PADDING,
  )

  const avatarImage = await Image.decode(avatar)
  image.composite(
    avatarImage.resize(AVATAR_SIZE, AVATAR_SIZE).cropCircle(),
    PADDING + AVATAR_BORDER / 2,
    image.height - (AVATAR_SIZE + AVATAR_BORDER / 2) - PADDING,
  )
}

export const createQuoteImage = async (
  quoteInput: {
    quote: string
    author: { displayName: string; avatar: Uint8Array }
  },
): Promise<Uint8Array> => {
  const phrase = await Image.renderText(
    phraseFont,
    42,
    `– ${quoteInput.quote}`,
    0xffffffff,
    new TextLayout({
      maxWidth: IMAGE_WIDTH - 2 * PADDING,
      horizontalAlign: 'bottom',
      wrapStyle: 'word',
    }),
  )

  const image = new Image(
    IMAGE_WIDTH,
    phrase.height + 3 * PADDING + AVATAR_SIZE + AVATAR_BORDER,
  )

  await drawBackground(image, backgroundSVG)
  await drawAvatar(image, quoteInput.author.avatar)

  const username = await Image.renderText(
    mentionFont,
    48,
    quoteInput.author.displayName,
    0xffffffff,
    new TextLayout({ verticalAlign: 'center' }),
  )
  image.composite(
    username,
    2 * PADDING + AVATAR_SIZE + AVATAR_BORDER,
    image.height - PADDING - AVATAR_SIZE + 20,
  )

  image.composite(phrase, PADDING, PADDING)

  return image.encode()
}
