import {prop} from "ramda"
import {env, settings} from "src/engine2/state"

export const getDefaultSettings = () => ({
  relay_limit: 10,
  default_zap: 21,
  show_media: true,
  report_analytics: true,
  imgproxy_url: env.get().IMGPROXY_URL,
  dufflepud_url: env.get().DUFFLEPUD_URL,
  multiplextr_url: env.get().MULTIPLEXTR_URL,
})

export const getSettings = () => ({...getDefaultSettings(), ...settings.get()})

export const getSetting = k => prop(k, getSettings())

export const imgproxy = (url: string, {w = 640, h = 1024} = {}) => {
  const base = getSetting("imgproxy_url")

  if (!url || url.match("gif$")) {
    return url
  }

  try {
    return base && url ? `${base}/x/s:${w}:${h}/${btoa(url)}` : url
  } catch (e) {
    return url
  }
}

export const dufflepud = (path: string) => `${getSetting("dufflepud_url")}/${path}`
