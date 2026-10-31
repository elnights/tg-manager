import jpeg from 'jpeg-js';
import {Api} from 'teleproto';
import {returnBigInt} from 'teleproto/Helpers.js';

export const image = jpeg.encode(
  {
    width: 80,
    height: 40,
    data: Buffer.from(
      Array.from({length: 80 * 40}, (_, index) => {
        const x = index % 80;
        const y = Math.floor(index / 80);
        if ((x - 60) ** 2 + (y - 10) ** 2 < 36) return [255, 220, 60, 255];
        return y > 27 - Math.sin(x / 10) * 8 ? [40, 110 + y * 2, 70, 255] : [70, 120 + y, 210, 255];
      }).flat(),
    ),
  },
  80,
).data;

export function photo(id = 1) {
  return new Api.MessageMediaPhoto({
    photo: new Api.Photo({
      id: returnBigInt(id),
      accessHash: returnBigInt(123),
      fileReference: Buffer.from('synthetic'),
      date: 0,
      dcId: 1,
      sizes: [new Api.PhotoCachedSize({type: 'm', w: 80, h: 40, bytes: image})],
    }),
  });
}
