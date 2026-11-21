// TMDB API 약관의 출처 표시: 로고(앱 이름보다 눈에 덜 띄게)와 정해진 문구
export function Attribution() {
  return (
    <footer class="attribution">
      <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">
        <img class="attribution-logo" src={`${import.meta.env.BASE_URL}tmdb-logo.svg`} alt="TMDB" />
      </a>
      <p>영화 정보와 포스터는 TMDB에서 가져와요.</p>
      <p lang="en">
        This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.
      </p>
    </footer>
  );
}
