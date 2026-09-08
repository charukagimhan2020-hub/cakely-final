import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, CakeSlice, ChevronDown, Menu, Search, ShoppingBag, Sparkles, X } from 'lucide-react'
import { api, unwrap } from './services/api'
import './styles.css'
import './extras.css'
import './admin/admin.css'
import './admin/login.css'
import './admin/upload.css'
import './customer.css'
import './account-nav.css'
import './product-actions.css'
import './coupon-rules.css'
import AdminPanel from './admin/AdminPanel'
import AdminLoginView from './admin/AdminLogin'
import CartView from './CartView'
import CustomerAccountPage from './CustomerAccount'
import CheckoutPage from './CheckoutRulesView'

const money = (value) => `Rs. ${Number(value || 0).toLocaleString('en-LK')}`
const normalizeCart = (items) => Object.values((items || []).reduce((groups, item) => {
  const key = `${item.productId || item.slug}-${item.size || '1 kg'}-${item.flavour || 'Vanilla'}`
  const current = groups[key]
  groups[key] = current ? { ...current, quantity: Number(current.quantity || 1) + Number(item.quantity || 1) } : { ...item, quantity: Number(item.quantity || 1) }
  return groups
}, {}))
const apiOrigin = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '')
const productImage = (product) => {
  if (!product) return ''
  if (product.image?.startsWith('/api/')) return `${apiOrigin}${product.image}`
  if (product.image?.startsWith('http')) return product.image
  return product.image || ''
}

function ProductCard({ product, add }) {
  return (
    <article className="product-card">
      <Link to={`/cakes/${product.slug}`} className="product-photo">
        <img src={productImage(product)} alt={product.name} />
        <span className="pill">{product.category}</span>
      </Link>
      <div className="product-info">
        <div>
          <p className="eyebrow">Freshly baked</p>
          <h3>{product.name}</h3>
          <p className="muted">From {money(product.basePrice)}</p>
        </div>
        <button className="circle-button" onClick={() => (localStorage.getItem('cakely_token') ? add(product) : window.location.assign('/login'))} aria-label={`Add ${product.name} to cart`}>
          <ShoppingBag size={17} />
        </button>
      </div>
    </article>
  )
}

function Home({ products, add }) {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow accent">Home baked, heart made</p>
          <h1>A little joy,<br /><em>made fresh.</em></h1>
          <p className="hero-text">Thoughtful cakes for ordinary days, big milestones, and everything sweet in between.</p>
          <Link to="/cakes" className="button primary">Browse the bakehouse <ArrowRight size={17} /></Link>
        </div>
        <div className="hero-art">
          <div className="hero-note"><Sparkles size={16} /><span>Baked today in Colombo</span></div>
        </div>
      </section>
      <section className="section intro">
        <div>
          <p className="eyebrow">The Cakely edit</p>
          <h2>Made for your<br /><em>moment.</em></h2>
        </div>
        <p className="intro-text">Small-batch cakes, familiar flavours, and a touch of magic. Every order is made with care in our home bakery and delivered across Colombo.</p>
      </section>
      <section className="section products-section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Our favourites</p>
            <h2>Good things <em>inside.</em></h2>
          </div>
          <Link to="/cakes" className="text-link">See all cakes <ArrowRight size={16} /></Link>
        </div>
        <div className="product-grid">{products.slice(0, 4).map((product) => <ProductCard key={product.slug} product={product} add={add} />)}</div>
      </section>
    </main>
  )
}

function Cakes({ products, add }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All cakes')
  const filtered = products.filter((product) => product.name.toLowerCase().includes(search.toLowerCase()) && (category === 'All cakes' || product.category === category))

  return (
    <main className="page">
      <div className="page-heading">
        <p className="eyebrow">The bakehouse</p>
        <h1>Find your<br /><em>favourite.</em></h1>
      </div>
      <div className="filters">
        <label className="search-field"><Search size={17} /><input placeholder="Search cakes" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="select-field">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>All cakes</option>
            <option>Classic cakes</option>
            <option>Special cakes</option>
            <option>Custom</option>
          </select>
          <ChevronDown size={16} />
        </label>
      </div>
      <div className="product-grid catalogue">{filtered.map((product) => <ProductCard key={product.slug} product={product} add={add} />)}</div>
    </main>
  )
}

function ProductDetail({ products, add, setCart }) {
  const { slug } = useParams()
  const navigate = useNavigate()
  const product = products.find((entry) => entry.slug === slug) || products[0]
  const [size, setSize] = useState('1 kg')
  const [flavour, setFlavour] = useState(product?.flavours?.[0] || 'Vanilla')
  const selected = { ...product, basePrice: product?.sizes?.[size] || product?.basePrice, size, flavour }
  const buyNow = () => {
    const item = {
      productId: selected.id || selected.slug,
      name: selected.name,
      slug: selected.slug,
      unitPrice: Number(selected.basePrice || 0),
      size: selected.size,
      flavour: selected.flavour,
      quantity: 1,
    }
    setCart([])
    navigate('/checkout', { state: { buyNow: true, item } })
  }

  return (
    <main className="page detail">
      <div className="detail-image"><img src={productImage(product)} alt={product.name} /></div>
      <div className="detail-copy">
        <p className="eyebrow">{product.category}</p>
        <h1>{product.name}</h1>
        <p className="detail-price">{money(product.sizes?.[size] || product.basePrice)}</p>
        <p className="detail-description">{product.description}</p>
        <div className="choice">
          <label>Size
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              {Object.keys(product.sizes || { '1 kg': product.basePrice }).map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <label>Flavour
            <select value={flavour} onChange={(e) => setFlavour(e.target.value)}>
              {(product.flavours || ['Vanilla']).map((entry) => <option key={entry}>{entry}</option>)}
            </select>
          </label>
        </div>
        <div className="product-actions">
          <button className="button primary" onClick={() => add(selected)}>Add to bag <ShoppingBag size={17} /></button>
          <button className="button secondary" onClick={buyNow}>Buy now <ArrowRight size={17} /></button>
        </div>
        <p className="delivery-note">Freshly baked to order · Delivery across Colombo</p>
      </div>
    </main>
  )
}

function CustomCake() {
  const [sent, setSent] = useState(false)
  const [form, setForm] = useState({ size: '1 kg', flavour: 'Vanilla', message: '', instructions: '' })

  const submit = async (event) => {
    event.preventDefault()
    await unwrap(api.post('/custom-cakes', form))
    setSent(true)
  }

  return (
    <main className="page custom">
      <div className="custom-art" />
      <div>
        <p className="eyebrow accent">Make it yours</p>
        <h1>One cake.<br /><em>Your story.</em></h1>
        <p className="detail-description">Send us your favourite photo and we’ll print it on a freshly baked cake. Custom requests are confirmed by our team before baking.</p>
        {sent ? (
          <div className="success">Request received. Our team will contact you to confirm the design.</div>
        ) : (
          <form className="custom-form" onSubmit={submit}>
            <label>Size<select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}><option>0.5 kg</option><option>1 kg</option><option>1.5 kg</option><option>2 kg</option><option>3 kg</option></select></label>
            <label>Flavour<select value={form.flavour} onChange={(e) => setForm({ ...form, flavour: e.target.value })}><option>Vanilla</option><option>Chocolate</option><option>Red Velvet</option><option>Fruit</option></select></label>
            <label>Message<input required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            <label>Special instructions<textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label>
            <button className="button primary">Send request <ArrowRight size={17} /></button>
          </form>
        )}
      </div>
    </main>
  )
}

function Login() {
  const [form, setForm] = useState({ identifier: '', password: '', username: '' })
  const [error, setError] = useState('')
  const location = useLocation()
  const isAdmin = new URLSearchParams(location.search).get('admin') === '1'

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const result = await unwrap(api.post('/auth/login', {
        identifier: form.identifier,
        password: form.password,
      }))
      localStorage.setItem('cakely_token', result.data.token)
      if (isAdmin) {
        window.location.assign('/admin')
      } else {
        window.location.assign('/account')
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Unable to sign in.')
    }
  }

  return (
    <main className="auth">
      <div className="auth-art">
        <p className="eyebrow accent">{isAdmin ? 'Cakely operations' : 'Welcome to Cakely'}</p>
        <h1>{isAdmin ? <>Admin<br /><em>access.</em></> : <>Good days<br /><em>start here.</em></>}</h1>
      </div>
      <form onSubmit={submit}>
        <p className="eyebrow">{isAdmin ? 'Administrator login' : 'Welcome back'}</p>
        <h2>{isAdmin ? 'Sign in as admin' : 'Sign in to your account'}</h2>
        <label>{isAdmin ? 'Username' : 'Email or username'}<input required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} /></label>
        <label>Password<input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {error && <p className="error">{error}</p>}
        <button className="button primary wide">Sign in <ArrowRight size={17} /></button>
        {!isAdmin && <><Link to="/register" className="text-link">Create an account <ArrowRight size={14} /></Link><Link to="/admin/login?admin=1" className="text-link admin-login-link">Administrator login <ArrowRight size={14} /></Link></>}
      </form>
    </main>
  )
}

function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const submit = async (event) => { event.preventDefault(); setError(''); try { const result = await unwrap(api.post('/auth/register', form)); localStorage.setItem('cakely_token', result.data.token); navigate('/account') } catch (err) { setError(err.response?.data?.error?.message || 'Unable to create your account.') } }
  return <main className="auth"><div className="auth-art"><p className="eyebrow accent">Fresh starts</p><h1>Make room<br/><em>for cake.</em></h1></div><form onSubmit={submit}><p className="eyebrow">New customer</p><h2>Create your account</h2><label>Username<input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}/></label><label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/></label><label>Password<input type="password" minLength="8" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}/></label>{error && <p className="error">{error}</p>}<button className="button primary wide">Create account <ArrowRight size={17}/></button><Link className="text-link" to="/login">Already have an account? Sign in</Link></form></main>
}

function App() {
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState(() => normalizeCart(JSON.parse(localStorage.getItem('cakely_cart') || '[]')))
  const location = useLocation()

  useEffect(() => {
    unwrap(api.get('/products')).then((result) => {
      if (Array.isArray(result.data)) setProducts(result.data)
    }).catch(() => setProducts([]))
  }, [])

  useEffect(() => {
    localStorage.setItem('cakely_cart', JSON.stringify(cart))
  }, [cart])

  const add = (product) => {
    const item = {
      productId: product.id || product.slug,
      name: product.name,
      slug: product.slug,
      unitPrice: Number(product.basePrice || product.sizes?.[product.size || '1 kg'] || 0),
      size: product.size || '1 kg',
      flavour: product.flavours?.[0] || 'Vanilla',
      quantity: 1,
    }
    setCart((items) => {
      const index = items.findIndex((existing) => existing.productId === item.productId && existing.size === item.size && existing.flavour === item.flavour)
      if (index < 0) return [...items, item]
      return items.map((existing, itemIndex) => itemIndex === index ? { ...existing, quantity: Number(existing.quantity || 1) + 1 } : existing)
    })
  }

  return (
    <>
      <header className="nav">
        <Link to="/" className="brand"><span className="brand-mark"><CakeSlice size={20} /></span><span>cakely</span></Link>
        <nav className="nav-links">
          <Link to="/cakes">Cakes</Link>
          <Link to="/custom-photo-cake">Custom cake</Link>
          <Link to="/account">My account</Link>
        </nav>
        <div className="nav-actions">
          <Link to="/cakes" className="icon-link" aria-label="Search cakes"><Search size={19} /></Link>
          <Link to="/cart" className="bag-link" aria-label="Shopping bag"><ShoppingBag size={20} /><b>{cart.length}</b></Link>
          <button className="menu-btn" aria-label="Menu"><Menu /></button>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Home products={products} add={add} />} />
        <Route path="/cakes" element={<Cakes products={products} add={add} />} />
        <Route path="/cakes/:slug" element={<ProductDetail products={products} add={add} setCart={setCart} />} />
        <Route path="/custom-photo-cake" element={<CustomCake />} />
        <Route path="/cart" element={<CartView cart={cart} setCart={setCart} />} />
        <Route path="/checkout" element={<CheckoutPage cart={cart} setCart={setCart} />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/account" element={<CustomerAccountPage />} />
        <Route path="/admin/login" element={<AdminLoginView />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="*" element={<Home products={products} add={add} />} />
      </Routes>
      {['/checkout', '/admin', '/admin/login'].includes(location.pathname) ? null : (
        <footer>
          <div className="brand"><span className="brand-mark"><CakeSlice size={20} /></span>cakely</div>
          <p>Home baked in Colombo, Sri Lanka.</p>
          <div>
            <Link to="/cakes">Cakes</Link>
            <Link to="/custom-photo-cake">Custom cake</Link>
            <Link to="/account">Account</Link>
          </div>
        </footer>
      )}
    </>
  )
}

const root = createRoot(document.getElementById('root'))
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
