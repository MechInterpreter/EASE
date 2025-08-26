// D3-jetpack extensions adapted from Neuronpedia webapp
// Provides helper methods for cleaner D3 code

import * as d3Base from 'd3'

type D3Jetpack = typeof d3Base & {
  clamp: (min: number, d: number, max: number) => number
  nestBy: <T>(array: T[], key: (d: T) => string) => Array<T[] & { key: string }>
}

// Create a mutable clone
const d3 = { ...(d3Base as any) } as D3Jetpack

// Extend d3 types for Selection methods we add
declare module 'd3' {
  interface Selection<GElement extends d3Base.BaseType, Datum, PElement extends d3Base.BaseType, PDatum> {
    appendMany<NewDatum>(name: string, data: NewDatum[]): d3Base.Selection<d3Base.BaseType, NewDatum, PElement, PDatum>
    at(name: string | Record<string, any>, value?: any): d3Base.Selection<GElement, Datum, PElement, PDatum>
    st(name: string | Record<string, any>, value?: any): d3Base.Selection<GElement, Datum, PElement, PDatum>
    translate(
      xy: [number, number] | ((d: any, i: number) => [number, number]),
      dim?: number,
    ): d3Base.Selection<GElement, Datum, PElement, PDatum>
  }
}

// Helper function to parse attributes from tag names like "div.class#id"
function parseAttributes(name: string | any): {
  tag: string
  attr: Record<string, any>
} {
  if (typeof name === 'string') {
    const attr: Record<string, any> = {}
    const parts = name.split(/([\.#])/g)
    let p: string

    name = parts.shift() || ''
    while ((p = parts.shift() as string)) {
      if (p == '.') attr.class = attr.class ? `${attr.class} ${parts.shift()}` : parts.shift()
      else if (p == '#') attr.id = parts.shift()
    }
    return { tag: name, attr }
  }
  return name
}

// Add appendMany method to d3.selection
d3.selection.prototype.appendMany = function (name, data) {
  return this.selectAll(name).data(data).join(name)
}

// Override append method to support class/id syntax
d3.selection.prototype.append = function (name) {
  let create
  let n

  if (typeof name === 'function') {
    create = name
  } else {
    n = parseAttributes(name)
    create = d3.creator(n.tag)
  }

  const sel = this.select(function () {
    return this.appendChild(create.apply(this, arguments))
  })

  if (n) {
    for (const key in n.attr) {
      sel.attr(key, n.attr[key])
    }
  }
  return sel
}

// Add at method for attributes
d3.selection.prototype.at = function (name, value) {
  if (typeof name === 'object') {
    for (const key in name) {
      this.attr(key, name[key])
    }
    return this
  }
  return arguments.length == 1 ? this.attr(name) : this.attr(name, value)
}

// Add st method for styling with auto-px
d3.selection.prototype.st = function (name, value) {
  function addPx(d: any) {
    return d.match ? d : `${d}px`
  }

  function wrapPx(fn: Function) {
    return function () {
      const val = fn.apply(this, arguments)
      return addPx(val)
    }
  }

  function addStyle(sel: any, style: string, value: any) {
    style = style.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase()

    const pxStyles =
      'top left bottom right padding-top padding-left padding-bottom padding-right border-top border-left-width border-bottom-width border-right-width margin-top margin-left margin-bottom margin-right font-size width stroke-width line-height margin padding border border-radius max-width min-width max-height min-height gap'

    if (pxStyles.indexOf(style) >= 0) {
      sel.style(style, typeof value === 'function' ? wrapPx(value) : addPx(value))
    } else {
      sel.style(style, value)
    }

    return sel
  }

  if (typeof name === 'object') {
    for (const key in name) {
      addStyle(this, key, name[key])
    }
    return this
  }
  return arguments.length == 1 ? this.style(name) : addStyle(this, name as string, value)
}

// Add translate method
d3.selection.prototype.translate = function (xy, dim) {
  const node = this.node()
  return !node
    ? this
    : node.getBBox
      ? this.attr('transform', function (d, i) {
          const p = typeof xy === 'function' ? xy.call(this, d, i) : xy
          if (dim === 0) return `translate(${p},0)`
          if (dim === 1) return `translate(0,${p})`
          return `translate(${p[0]},${p[1]})`
        })
      : this.style('transform', function (d, i) {
          const p = typeof xy === 'function' ? xy.call(this, d, i) : xy
          if (dim === 0) return `translate(${p}px,0px)`
          if (dim === 1) return `translate(0px,${p}px)`
          return `translate(${p[0]}px,${p[1]}px)`
        })
}

// Add nestBy function
;(d3 as any).nestBy = function <T>(array: T[], key: (d: T) => string): Array<T[] & { key: string }> {
  return d3.groups(array, key).map(([key, values]) => {
    ;(values as any).key = key
    return values as any
  })
}

// Add clamp function
;(d3 as any).clamp = function (min: number, d: number, max: number): number {
  return Math.max(min, Math.min(max, d))
}

export default d3
