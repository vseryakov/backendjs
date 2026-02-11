
module.exports.defaults = {
    image: {
        width: 1280,
        height: 1280,
        background: "#000",
        fit: "cover",
    },

    logo: {
        gravity: "northwest",
        width: 160,
        padding: 200,
        fit: "cover",
    },

    title: {
        gravity: "west",
        padding_top: 20,
        padding: 70,
        width: 700,
        dpi: 600,
        font: "Roboto",
        color: "#fff",
        bold: 1,
    },

    subtitle: {
        gravity: "southwest",
        padding: 70,
        width: 700,
        dpi: 400,
        font: "Sans Serif",
        color: "#eee",
        bold: 1,
        italic: 1,
    },

    avatar: {
        gravity: "east",
        padding: 70,
        width: 500,
        radius: 10,
        color: "#ffffff70"
    },

    name: {
        gravity: "southeast",
        padding: 70,
        dpi: 300,
        font: "Montserrat, Helvetica Neue, Arial, Sans Serif",
        color: "#fff",
        bold: 1,
    },
};

const image = module.image = {
    file: {},
    width: { type: "int" },
    height: { type: "int" },
    background: {},
    color: {},
    gravity: {},
    radius: { type: "int" },
    border: { type: "int" },
    padding: { type: "int" },
    padding_x: { type: "int" },
    padding_y: { type: "int" },
    padding_top: { type: "int" },
    padding_bottom: { type: "int" },
    padding_left: { type: "int" },
    padding_right: { type: "int" },
    fit: {},
    position: {},
    kernel: {},
    withoutEnlargement: { type: "bool" },
    withoutReduction: { type: "bool" },
    fastShrinkOnLoad: { type: "bool" },

};

const text = module.exports.text = {
    text: {},
    size: {},
    font: {},
    fontfile: {},
    width: { type: "int" },
    height: { type: "int" },
    spacing: { type: "int" },
    align: {},
    justify: { type: "bool" },
    wrap: {},
    gravity: {},
    color: {},
    dpi: { type: "int" },
    bold: { type: "bool" },
    italic: { type: "bool" },
}

module.exports.schema ={
    image: {
        type: "obj",
        params: image,
    },
    logo: {
        type: "obj",
        params: image,
    },
    avatar: {
        type: "obj",
        params: image,
    },
    name: {
        type: "obj",
        params: text,
    },
    title: {
        type: "obj",
        params: text,
    },
    subtitle: {
        type: "obj",
        params: text,
    },
}

