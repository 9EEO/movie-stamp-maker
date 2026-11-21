// jsdom의 Blob/File에는 text()가 없다. 브라우저처럼 동작하도록 FileReader로 채운다.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function' && typeof FileReader !== 'undefined') {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
