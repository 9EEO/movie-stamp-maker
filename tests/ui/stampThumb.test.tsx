import { render } from '@testing-library/preact';
import { DEFAULT_CROP } from '../../src/core/crop';
import { StampThumb } from '../../src/ui/StampThumb';

test('thumbnail image is requested in CORS mode', () => {
  const { container } = render(
    <StampThumb src="https://image.tmdb.org/t/p/w185/a.jpg" crop={DEFAULT_CROP} alt="a" />,
  );
  expect(container.querySelector('img')?.getAttribute('crossorigin')).toBe('anonymous');
});
