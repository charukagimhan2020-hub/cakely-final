import axios from 'axios'

const configuredBase = import.meta.env.VITE_API_URL || '/api'
const baseURL = configuredBase.replace(/\/$/, '').endsWith('/api') ? configuredBase.replace(/\/$/, '') : `${configuredBase.replace(/\/$/, '')}/api`
export const api = axios.create({ baseURL, headers: { 'Content-Type': 'application/json' } })
function getSessionId() {
	let id = localStorage.getItem('cakely_session_id')
	if (!id) {
		id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`
		localStorage.setItem('cakely_session_id', id)
	}
	return id
}
api.interceptors.request.use((config) => { const token = localStorage.getItem('cakely_token'); if (token) config.headers.Authorization = `Bearer ${token}`; config.headers['X-Session-ID'] = getSessionId(); return config })
api.interceptors.request.use((config) => {
	if (typeof FormData !== 'undefined' && config.data instanceof FormData) delete config.headers['Content-Type']
	return config
})
export const unwrap = (request) => request.then((response) => response.data)
