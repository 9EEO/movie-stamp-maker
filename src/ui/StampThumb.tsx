import { useState } from 'preact/hooks';
import { type Crop, placeImage } from '../core/crop';
import { STAMP_H_MM, STAMP_W_MM } from '../core/layout';

interface Props {
  src?: string;
  crop?: Crop;
  alt: string;
  class?: string;
}

/** 톱니 가장자리(CSS mask) 우표 썸네일. crop을 주면 출력과 같은 위치로 보여준다. */
export function StampThumb({ src, crop, alt, class: cls }: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  let style: Record<string, string> | undefined;
  if (crop && size) {
    const r = placeImage(size.w, size.h, crop);
    style = {
      position: 'absolute',
      left: `${(r.xMm / STAMP_W_MM) * 100}%`,
      top: `${(r.yMm / STAMP_H_MM) * 100}%`,
      width: `${(r.wMm / STAMP_W_MM) * 100}%`,
      height: `${(r.hMm / STAMP_H_MM) * 100}%`,
      maxWidth: 'none',
    };
  }
  return (
    <div class={`stamp ${cls ?? ''}`}>
      <div class="stamp-face">
        {src ? (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            // CORS 모드로 받아야 서비스 워커 캐시가 출력용 fetch와 같이 쓰인다
            crossOrigin="anonymous"
            draggable={false}
            class={style ? undefined : 'stamp-cover'}
            style={style}
            onLoad={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              setSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
        ) : (
          <span class="stamp-empty">{alt}</span>
        )}
      </div>
    </div>
  );
}
