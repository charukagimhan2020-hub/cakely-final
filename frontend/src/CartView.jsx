import { Link } from 'react-router-dom'
import { ArrowRight, ShoppingBag, X } from 'lucide-react'

const money = (value) => `Rs. ${Number(value || 0).toLocaleString('en-LK')}`
const apiOrigin = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '')
const fallbackImage = 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=300&q=80'
const resolveImage = (item) => item.image?.startsWith('/api/') ? `${apiOrigin}${item.image}` : item.image?.startsWith('http') ? item.image : fallbackImage

export default function CartView({ cart, setCart }) {
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const changeQuantity = (index, delta) => setCart(cart.flatMap((item, itemIndex) => { if (itemIndex !== index) return [item]; const quantity = Number(item.quantity || 1) + delta; return quantity > 0 ? [{ ...item, quantity }] : [] }))
  return <main className="page narrow"><div className="page-heading compact"><p className="eyebrow">Your selection</p><h1>The <em>bag.</em></h1></div>{cart.length ? <><div className="cart-list">{cart.map((item, index) => <div className="cart-row" key={`${item.productId}-${item.size}-${item.flavour}`}><img src={resolveImage(item)} alt={item.name}/><div><h3>{item.name}</h3><p className="muted">{item.size} · {item.flavour}</p><div className="cart-quantity"><button onClick={() => changeQuantity(index, -1)} aria-label={`Decrease ${item.name}`}>-</button><span>{item.quantity}</span><button onClick={() => changeQuantity(index, 1)} aria-label={`Increase ${item.name}`}>+</button></div></div><strong>{money(item.unitPrice * item.quantity)}</strong><button onClick={() => setCart(cart.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${item.name}`}><X size={17}/></button></div>)}</div><div className="summary"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>Delivery</span><strong>{money(350)}</strong></div><div className="summary-total"><span>Total</span><strong>{money(subtotal + 350)}</strong></div><Link className="button primary wide" to="/checkout">Continue to checkout <ArrowRight size={17}/></Link></div></> : <div className="empty"><ShoppingBag size={32}/><h2>Your bag is waiting.</h2><Link to="/cakes" className="button primary">Explore cakes</Link></div>}</main>
}
