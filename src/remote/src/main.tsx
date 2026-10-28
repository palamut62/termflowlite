import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadToken } from './client'
import { installNativeReceiver } from './native'
import './styles.css'

installNativeReceiver(loadToken)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
