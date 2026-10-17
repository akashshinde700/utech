import api from './api';

// Downloads a binary endpoint through the shared axios instance, so the
// Authorization header, error toasts and 401 redirect all behave exactly like
// every other request in the app.
//
// `endpoint` is relative to the API base (`/reports/items.xlsx`).
export async function downloadFile(endpoint, filename) {
  const { data } = await api.get(endpoint, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke after the browser has had a tick to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default downloadFile;
