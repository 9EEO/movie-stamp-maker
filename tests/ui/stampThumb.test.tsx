import { render } from '@testing-library/preact';
import { DEFAULT_CROP } from '../../src/core/crop';
import { StampThumb } from '../../src/ui/StampThumb';

test('thumbnail image is requested in CORS mode', () => {
  const { container } = render(
    <StampThumb src="https://image.tmdb.org/t/p/w185/a.jpg" crop={DEFAULT_CROP} alt="a" />,
  );
  expect(container.querySelector('img')?.getAttribute('crossorigin')).toBe('anonymous');
});

test('stamp face uses crop.bg as its background', () => {
  const { container } = render(
    <StampThumb src="x.jpg" crop={{ mode: 'fit', cx: 0.5, cy: 0.5, zoom: 1, bg: '#123456' }} alt="a" />,
  );
  expect((container.querySelector('.stamp-face') as HTMLElement).style.backgroundColor).toBe('rgb(18, 52, 86)');
});
