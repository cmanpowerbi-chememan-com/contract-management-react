import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:8000' });

export const getContracts      = () => api.get('/api/contracts').then(r => r.data.data);
export const getDocNumbers     = () => api.get('/api/doc-numbers').then(r => r.data.doc_numbers);
export const getStatus         = () => api.get('/api/status').then(r => r.data.data);
export const refreshStatus     = () => api.get('/api/status/refresh').then(r => r.data.data);
export const getOptions        = () => api.get('/api/status-options').then(r => r.data.options);
export const saveStatus        = (entry) => api.post('/api/status', entry).then(r => r.data);
