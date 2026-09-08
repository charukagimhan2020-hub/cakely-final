import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Tag } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, unwrap } from './services/api'

const money = (value) => `Rs. ${Number(value || 0).toLocaleString('en-LK')}`
const percentageCodes = new Set(['CAKE10', 'CAKE20', 'CAKE30', 'CAKE50'])
const couponRules = {
  CAKE50: { methods: ['CARD'], label: 'Card only' },
  CAKE30: { methods: ['COD'], label: 'COD only' },
  SAVE500: { methods: ['COD'], label: 'COD only' },
  FIRSTCAKE: { methods: ['CARD'], label: 'Card only' },
  FREEDESSERT: { methods: ['COD'], label: 'COD only' },
}

export default function CheckoutRulesView({ cart, setCart }) {
  const navigate = useNavigate()
  const location = useLocation()
  const checkoutCart = location.state?.buyNow && location.state.item ? [location.state.item] : cart
  const [coupons, setCoupons] = useState([])
  const [addresses, setAddresses] = useState([])
  const [selected, setSelected] = useState([])
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    city: 'Colombo',
    district: 'Colombo',
    postalCode: '',
    paymentMethod: 'COD',
  })
  const [error, setError] = useState('')

  const subtotal = useMemo(() => checkoutCart.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 1), 0), [checkoutCart])
  const selectedCoupons = coupons.filter((coupon) => selected.includes(coupon.code))
  const estimatedDiscount = selectedCoupons.reduce((sum, coupon) => {
    if (coupon.discountType === 'PERCENTAGE') return sum + (subtotal * Number(coupon.discountValue || 0)) / 100
    if (coupon.discountType === 'FIXED') return sum + Number(coupon.discountValue || 0)
    return sum
  }, 0)
  const freeDelivery = selectedCoupons.some((coupon) => coupon.freeDelivery)
  const deliveryFee = freeDelivery ? 0 : 350
  const codFee = form.paymentMethod === 'COD' ? 150 : 0
  const total = Math.max(0, subtotal - estimatedDiscount + deliveryFee + codFee)

  useEffect(() => {
    Promise.all([unwrap(api.get('/auth/me')), unwrap(api.get('/coupons')), unwrap(api.get('/addresses'))])
      .then(([, couponData, addressData]) => { setCoupons(Array.isArray(couponData.data) ? couponData.data : []); const saved = Array.isArray(addressData.data) ? addressData.data : []; setAddresses(saved); if (saved[0]) setForm((current) => ({ ...current, ...saved[0], postalCode: saved[0].postal_code || '' })) })
      .catch(() => navigate('/login'))
  }, [navigate])

  useEffect(() => {
    setSelected((current) => current.filter((code) => {
      const rule = couponRules[code]
      return !rule || rule.methods.includes(form.paymentMethod)
    }))
  }, [form.paymentMethod])

  const ruleFor = (coupon) => couponRules[coupon.code]
  const isDisabled = (coupon) => {
    const rule = ruleFor(coupon)
    if (rule && !rule.methods.includes(form.paymentMethod)) return true
    if (selected.includes(coupon.code)) return false
    if (percentageCodes.has(coupon.code) && selected.some((code) => percentageCodes.has(code))) return true
    return false
  }

  const disabledReason = (coupon) => {
    const rule = ruleFor(coupon)
    if (rule && !rule.methods.includes(form.paymentMethod)) return rule.label
    if (percentageCodes.has(coupon.code) && selected.some((code) => percentageCodes.has(code))) return 'Only one percentage coupon'
    return ''
  }

  const toggleCoupon = (coupon) => {
    if (isDisabled(coupon)) return
    setSelected((current) => current.includes(coupon.code)
      ? current.filter((item) => item !== coupon.code)
      : [...current, coupon.code])
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const result = await unwrap(api.post('/checkout', {
        items: checkoutCart,
        address: form,
        paymentMethod: form.paymentMethod,
        coupons: selected,
        discount: estimatedDiscount,
        freeDelivery,
      }))
      setCart([])
      navigate('/account', { state: { order: result.data } })
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Unable to place your order.')
    }
  }

  return (
    <main className="checkout">
      <div>
        <p className="eyebrow">Almost yours</p>
        <h1>Complete<br /><em>your order.</em></h1>
        <p className="muted">Fresh cakes, delivered across Colombo.</p>
        <div className="checkout-summary">
          <span>Subtotal</span><strong>{money(subtotal)}</strong>
          <span>Estimated discount</span><strong>- {money(estimatedDiscount)}</strong>
          <span>Delivery</span><strong>{freeDelivery ? 'Free' : money(deliveryFee)}</strong>
          <span>COD fee</span><strong>{codFee ? money(codFee) : 'None'}</strong>
          <span className="checkout-total-label">Total</span>
          <strong className="checkout-total-value">{money(total)}</strong>
        </div>
      </div>

      <form className="checkout-form" onSubmit={submit}>
        <h2>Delivery details</h2>
        {addresses.length > 0 && <label>Use a saved address<select value={form.savedAddressId || ''} onChange={(event) => { const saved = addresses.find((address) => String(address.id) === event.target.value); setForm(saved ? { ...form, ...saved, savedAddressId: event.target.value, postalCode: saved.postal_code || '' } : { ...form, savedAddressId: '' }) }}><option value="">Enter a new address</option>{addresses.map((address) => <option value={address.id} key={address.id}>{address.label} · {address.address}</option>)}</select></label>}
        {['name', 'phone', 'address', 'city', 'district', 'postalCode'].map((field) => (
          <label key={field}>
            {field === 'postalCode' ? 'Postal code' : field[0].toUpperCase() + field.slice(1)}
            <input required value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />
          </label>
        ))}

        <section className="coupon-box">
          <div className="coupon-heading">
            <div>
              <p className="eyebrow">Make it sweeter</p>
              <h3>Available coupons</h3>
            </div>
            <Tag size={20} />
          </div>
          <p className="coupon-rule-note">One percentage coupon at a time. Payment-specific coupons are disabled automatically.</p>
          {coupons.length ? coupons.map((coupon) => {
            const disabled = isDisabled(coupon)
            const reason = disabledReason(coupon)
            return (
              <button
                type="button"
                disabled={disabled}
                className={`${selected.includes(coupon.code) ? 'coupon-option selected' : 'coupon-option'}${disabled ? ' disabled' : ''}`}
                key={coupon.code}
                onClick={() => toggleCoupon(coupon)}
              >
                <span>
                  <strong>{coupon.code}</strong>
                  <small>{coupon.description}{reason ? ` · ${reason}` : ''}</small>
                </span>
                {selected.includes(coupon.code) ? <Check size={17} /> : (
                  <span>{coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}%` : coupon.freeDelivery ? 'FREE' : money(coupon.discountValue)}</span>
                )}
              </button>
            )
          }) : <p className="muted">No coupons are available right now.</p>}
        </section>

        <fieldset>
          <legend>Payment method</legend>
          <label>
            <input type="radio" checked={form.paymentMethod === 'COD'} onChange={() => setForm({ ...form, paymentMethod: 'COD' })} />
            Cash on delivery <small>+ Rs. 150</small>
          </label>
          <label>
            <input type="radio" checked={form.paymentMethod === 'CARD'} onChange={() => setForm({ ...form, paymentMethod: 'CARD' })} />
            Card payment
          </label>
          <label>
            <input type="radio" checked={form.paymentMethod === 'BANK'} onChange={() => setForm({ ...form, paymentMethod: 'BANK' })} />
            Bank transfer
          </label>
        </fieldset>

        {error && <p className="error">{error}</p>}
        <button className="button primary wide">Place order <ArrowRight size={17} /></button>
      </form>
    </main>
  )
}
