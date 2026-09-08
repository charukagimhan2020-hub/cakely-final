import axios from 'axios'

const configuredBase = import.meta.env.VITE_API_URL || '/api'
const baseURL = configuredBase.replace(/\/$/, '').endsWith('/api') ? configuredBase.replace(/\/$/, '') : `${configuredBase.replace(/\/$/, '')}/api`
export const api = axios.create({ baseURL, headers: { 'Content-Type': 'application/json' } })
api.interceptors.request.use((config) => { const token = localStorage.getItem('cakely_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
api.interceptors.request.use((config) => {
	if (typeof FormData !== 'undefined' && config.data instanceof FormData) delete config.headers['Content-Type']
	return config
})
export const unwrap = (request) => request.then((response) => response.data)
