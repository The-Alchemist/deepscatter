import { sum, range as arange, shuffle, extent } from 'd3-array';
import { scaleLinear, scaleSqrt, scaleLog } from 'd3-scale'
import { rgb } from 'd3-color';
import { interpolatePuOr, interpolateViridis, interpolateWarm, interpolateCool
 } from 'd3-scale-chromatic';

import { * as d3Chromatic } from 'd3-scale-chromatic';

const scales = {
  sqrt: scaleSqrt,
  log: scaleLog,
  linear: scaleLinear
}

function to_buffer(data) {
  const output = new Uint8Array(4 * 1024)
  output.set(data.flat())
  return output
}

const palette_size = 1024
const viridis_raw = arange(palette_size).map(i => {
  const p = rgb(interpolateViridis(i/palette_size));
  return [p.r, p.g, p.b, 255]
});


const niccoli_rainbow = arange(1023).map(i => {
  let p;
  if (i < 512) {
    p = interpolateWarm(i/511)
  } else {
    p = interpolateCool((512 - (i - 512))/511)
  }
  p = rgb(p);
  return [p.r, p.g, p.b, 255]
})

const shufbow = shuffle([...niccoli_rainbow])


const color_palettes = {
  viridis: to_buffer(viridis_raw),
  niccoli_rainbow: to_buffer(niccoli_rainbow),
  shufbow: to_buffer(shufbow)
}


console.log(d3Chromatic)
for (let k of Object.keys(d3Chromatic)) {
  if (k.startsWith("scheme")) {
    console.log(k)
  }
  console.log(k)
  color_palettes[k]
}

export const default_aesthetics = {
  "color": {
    range: color_palettes.viridis,
    transform: "linear"
  },
  "jitter_radius": {
    range: [0, 0.05],
    transform: 'sqrt'
  },
  "jitter_speed": {
    range: [.05, 1],
    transform: "linear"
  },
  "size": {
    range: [.5, 5],
    transform: "sqrt"
  },
  "alpha": {
    range: [0, 1],
    transform: "linear"
  },
  "filter": {
    range: [0, 1],
    transform: "linear"
  }
}

class Aesthetic {

  get default_val() {return 1};

  get texture_size() {
    return 1024
  }

  get_domain() {
    return this.domain
  }

  get transform() {
    if (this._transform) return this._transform
    return default_aesthetics[this.label].transform
  }

  get default_range() {
    return default_aesthetics[this.label].range
  }

  get default_domain() {

    if (this.field == undefined) {
      return [1, 1]
    }
    if (this._domains[this.field]) {
      return this._domains[this.field]
    } else {
      // Maybe the table is checked out
      if (!this.tileSet.table) {return [1,1]}
      const column = this.tileSet.table.getColumn(this.field)
      if (column.type.dictionary) {
        this._domains[this.field] = [0, this.texture_size - 1]
      } else {
        this._domains[this.field] = extent(column.toArray())
      }
      return this._domains[this.field]
    }

  }

  constructor(label, regl, tile) {
    this.label = label
    this.regl = regl

    this._domain = [1, 1]
    this._range = this.default_data()

    this.tileSet = tile;

    this._domains = {}
    this.create_textures()
  }

  default_data() {
    return encodeFloatsRGBA(Array(this.texture_size)
      .fill(this.default_val))
  }


  get domain() {
    return this._domain || this.default_domain
  }
  get range() {
    return this._range || this.default_range
  }

  create_textures() {

    this.texture_buffer = new Uint8Array(this.texture_size * 4)
    this.texture_buffer.set(this.default_data())

    const params = {
      width: 1,
      height: this.texture_size,
      type: 'uint8',
      format: 'rgba',
      data: this.default_data()
    }

    // Store the current and the last values for transitions.
    this.textures = [
      this.regl.texture(params),
      this.regl.texture(params)
    ]
    this.post_to_regl_buffer(0)
    this.post_to_regl_buffer(1)

    return this.textures;
  }

  summary() {
    console.log(this.label)
    console.log(`  Field : ${this.field}`)
  }

  key() {
    return this.field + this.domain + this.range + this.transform
  }

  post_to_regl_buffer(buffer_index) {
    this.textures[buffer_index].subimage({
      data: this.texture_buffer, width: 1, height: this.texture_size
    })
  }

  clear() {
    this.texture_buffer.set(this.default_data())
    this.post_to_regl_buffer(1)
    this.last_field = this.field
    this.field = undefined;
    this._domain = undefined;
    this._range = undefined;
    this._transform = undefined;
  }

  update(encoding) {
    if (encoding === null || encoding === undefined) {
      return this.clear()
    }

    if (typeof(encoding) == "string") {
      encoding = parseLambdaString(encoding)
    }
    if (encoding.lambda) {
      // May overwrite 'field!!'
      Object.assign(encoding, parseLambdaString(encoding.lambda))
    }
    const { label } = this;
    const { lambda, field } = encoding;

    if( field !== this.field) {
      this.clear()
    }

    // Store the last and current values.
    this.last_field = this.field
    this.field = field

    this.last_domain = [...this.domain]
    this.last_range = [...this.range]

    // resets to default if undefined
    this._range = encoding.range
    this._domain = encoding.domain
    this._transform = encoding.transform;

    if (typeof(encoding) == "number") {
      this._range = [encoding, encoding]
    }

    const {range, domain, transform } = this;

    // Passing a number directly means that all data
    // will simply be represented as that number.
    // Still maybe at the cost of a texture lookup, though.


    // Set up the 'previous' value from whatever's currently
    // being used.
    this.post_to_regl_buffer(0)

    if (lambda) {
      this.apply_function_to_textures(field, this.domain, lambda)
    } else {
      this.encode_for_textures(this.range)
    }

    this.post_to_regl_buffer(1)


  }

  encode_for_textures(range) {

    const values = new Array(this.texture_size);
    this.scaleFunc = scales[this.transform]()
      .range(range)
      .domain([0, this.texture_size - 1])

    for (let i = 0; i < this.texture_size; i += 1) {
      values[i] = this.scaleFunc(i)
    }

    this.texture_buffer.set(
      encodeFloatsRGBA(values, this.texture_buffer)
    );
  }

  apply_function_to_textures(field, range, function_string) {

    let func;
    let [name, lambda] = function_string.split("=>").map(d => d.trim())
    if (lambda == undefined) {
      func = Function("x", function_string)
    } else {
      func = Function(name, lambda)
    }

    this.scaleFunc = scaleLinear().range(range).domain([0, this.texture_size - 1])
    let input = arange(this.texture_size)
    if (field === undefined || this.tileSet.table == undefined) {
      this.texture_buffer.set(encodeFloatsRGBA(arange(this.texture_size).map(i => 1)))
      return
    }
    const column = this.tileSet.table.getColumn(field)
    if (column.type.dictionary) {
      const lookup = this.tileSet.dictionary_lookups[field]
      try {
        input = input.map(d => lookup.get(d))
      } catch(err) {
        console.log(err)
      }
    } else {
      input = input.map(d => this.scaleFunc(d))
    }
    const values = input.map(i => +func(i))
    this.texture_buffer.set(encodeFloatsRGBA(values))

  }

}

class Size extends Aesthetic {
  get default_val() {return 1};
}

class Alpha extends Aesthetic {
  get default_val() {return 1};
}

class Filter extends Aesthetic {

  get default_val() {
    return 1
  };

  fupdate(encoding) {
    if (typeof(encoding) == "string") {

    }

    let field;
    let function_arg;
    let { lambda } = encoding
    if (lambda === undefined) {lambda = encoding}
    if (lambda === undefined) {
      [function_arg, lambda] = ["x", "true"]
    } else {
      [function_arg, lambda] = lambda.split("=>").map(d => d.trim())
    }

    // Copy arrow notation convention.
    if (lambda && lambda.slice(0) != "{" && lambda.slice(0, 6) != "return") {
      lambda = "return " + lambda
    }

    // Reconstitute the lambda.
    const func = `${function_arg} => ${lambda}`
    field = encoding.field || function_arg;
    super.update(
      {
        field: field,
        lambda: func
      }
    )
  }
}

class Jitter_speed extends Aesthetic {
  get default_val() {return .1};
}

class Jitter_radius extends Aesthetic {
  get default_val() {return .05};
}

class Color extends Aesthetic {

  get default_val() {return [128, 150, 213, 255]}

  default_data() {
    return color_palettes.viridis
  }

  encode_for_textures(range) {

    if (color_palettes[range]) {
      this.texture_buffer.set(color_palettes[range])
    } else if (range.length == 4096) {
      this.texture_buffer.set(range)
    } else {
      console.warn(`${range} unknown`)
    }
  }

}

export default {
  Size, Alpha, Jitter_speed, Jitter_radius, Color, Filter
};

// A really stupid way to encode floats into rgb values.
// Stores numbers from -255.98 to 255.98 with a resolution of
// 1/255/255.
function encodeFloatsRGBA(values, array) {
  if (array == undefined) {
    array = new Uint8Array(values.length * 4)
  }
  if (typeof(values[0])=="boolean") {
    // true, false --> 1, 0
    values = values.map(d => +d)
  }
  let p = 0
  for (let value of values) {
    const logged = Math.log(value)
    if (value < 0) {
      array[p] = 1; value = -value;
    } else {
      array[p] = 0
    }
    array[p + 1] = (value % (1/256)) * 256 * 256
    array[p + 2] = (value % 1 - value % (1/256)) * 256
    array[p + 3] = value;
    p += 4
   }
  return array
}/*
float RGBAtoFloat(in vec4 floater) {
  decoder = vec4(-1., 1./255./255., 1./255., 1.]);
  return dot(floater, decoder);
}
*/


function parseLambdaString(lambdastring) {

  let [field, lambda] = lambdastring.split("=>").map(d => d.trim())
  if (lambda === undefined) {
    throw `Couldn't parse ${lambdastring} into a function`
  }
  if (lambda.slice(0) != "{" && lambda.slice(0, 6) != "return") {
    lambda = "return " + lambda
  }
  const func = `${field} => ${lambda}`
  return {
    field: field,
    lambda: func
  }

}
