import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Tag } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, unwrap } from './services/api'

const money = (value) => `Rs. ${Number(value || 0).toLocaleString('en-LK')}`
export default function CheckoutView({ cart, setCart }) {
  const navigate = useNavigate()
  const [coupons, setCoupons] = useState([])
  const [selected, setSelected] = useState([])
  const [form, setForm] = useState({ name: '', phone: '', address: '', city: 'Colombo', district: 'Colombo', postalCode: '', paymentMethod: 'COD' })
  const [error, setError] = useState('')
  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0), [cart])
  const selectedCoupons = coupons.filter((coupon) => selected.includes(coupon.code))
  const estimatedDiscount = selectedCoupons.reduce((sum, coupon) => sum + (coupon.discountType === 'PERCENTAGE' ? subtotal * coupon.discountValue / 100 : coupon.discountType === 'FIXED' ? coupon.discountValue : 0), 0)
  const freeDelivery = selectedCoupons.some((coupon) => coupon.freeDelivery)
  useEffect(() => { Promise.all([unwrap(api.get('/auth/me')), unwrap(api.get('/coupons'))]).then(([, couponData]) => setCoupons(Array.isArray(couponData.data) ? couponData.data : [])).catch(() => navigate('/login')) }, [navigate])
  const toggleCoupon = (code) => setSelected((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code])
  const submit = async (event) => { event.preventDefault(); setError(''); try { const result = await unwrap(api.post('/checkout', { items: cart, address: form, paymentMethod: form.paymentMethod, coupons: selected, discount: estimatedDiscount, freeDelivery })); setCart([]); navigate('/account', { state: { order: result.data } }) } catch (err) { setError(err.response?.data?.error?.message || 'Unable to place your order.') } }
  return <main className="checkout"><div><p className="eyebrow">Almost yours</p><h1>Complete<br/><em>your order.</em></h1><p className="muted">Fresh cakes, delivered across Colombo.</p><div className="checkout-summary"><span>Subtotal</span><strong>{money(subtotal)}</strong><span>Estimated discount</span><strong>- {money(estimatedDiscount)}</strong><span>Delivery</span><strong>{freeDelivery ? 'Free' : money(350)}</strong></div></div><form className="checkout-form" onSubmit={submit}><h2>Delivery details</h2>{['name','phone','address','city','district','postalCode'].map((field) => <label key={field}>{field === 'postalCode' ? 'Postal code' : field[0].toUpperCase() + field.slice(1)}<input required value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })}/></label>)}<section className="coupon-box"><div className="coupon-heading"><div><p className="eyebrow">Make it sweeter</p><h3>Available coupons</h3></div><Tag size={20}/></div>{coupons.length ? coupons.map((coupon) => <button type="button" className={selected.includes(coupon.code) ? 'coupon-option selected' : 'coupon-option'} key={coupon.code} onClick={() => toggleCoupon(coupon.code)}><span><strong>{coupon.code}</strong><small>{coupon.description}</small></span>{selected.includes(coupon.code) ? <Check size={17}/> : <span>{coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}%` : coupon.freeDelivery ? 'FREE' : money(coupon.discountValue)}</span>}</button>) : <p className="muted">No coupons are available right now.</p>}</section><fieldset><legend>Payment method</legend><label><input type="radio" checked={form.paymentMethod === 'COD'} onChange={() => setForm({ ...form, paymentMethod: 'COD' })}/> Cash on delivery <small>+ Rs. 150</small></label><label><input type="radio" checked={form.paymentMethod === 'CARD'} onChange={() => setForm({ ...form, paymentMethod: 'CARD' })}/> Mock Visa / Mastercard</label><label><input type="radio" checked={form.paymentMethod === 'BANK'} onChange={() => setForm({ ...form, paymentMethod: 'BANK' })}/> Bank transfer</label></fieldset>{error && <p className="error">{error}</p>}<button className="button primary wide">Place order <ArrowRight size={17}/></button></form></main>
}
