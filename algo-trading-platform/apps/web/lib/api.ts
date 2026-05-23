import axios, { AxiosError } from 'axios';

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

export const api = axios.create({
  baseURL: `${BASE}/api/v1`,
  withCredentials: true,
});

api.interceptors.request.use((cfg) => {
  if (typeof window === 'undefined') return cfg;
  const token = localStorage.getItem('accessToken');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      const refresh = localStorage.getItem('refreshToken');
      if (refresh && !err.config?.url?.includes('/auth/')) {
        try {
          const r = await axios.post(`${BASE}/api/v1/auth/refresh`, { refreshToken: refresh });
          localStorage.setItem('accessToken', r.data.accessToken);
          localStorage.setItem('refreshToken', r.data.refreshToken);
          if (err.config) {
            err.config.headers.Authorization = `Bearer ${r.data.accessToken}`;
            return api.request(err.config);
          }
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
        }
      } else if (!err.config?.url?.includes('/auth/login')) {
        window.location.href = '/login';
      }
    }
    throw err;
  },
);
