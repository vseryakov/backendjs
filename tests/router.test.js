
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { api } = require("../");

describe('Root Node', () => {
  const router = new api.Router()
  router.add('get', '/', 'get root')
  it('get /', () => {
    assert.strictEqual(router.find('get', '/')[0]?.route?.handler, 'get root')
    assert.strictEqual(router.find('get', '/hello').length, 0)
  })
})

describe('Root Node is not defined', () => {
  const router = new api.Router()
  router.add('get', '/hello', 'get hello')
  it('get /', () => {
    assert.strictEqual(router.find('get', '/').length, 0)
  })
})

describe('Get with *', () => {
  const router = new api.Router()
  router.add('get', '*', 'get all')
  it('get /', () => {
    assert.strictEqual(router.find('get', '/').length, 1)
    assert.strictEqual(router.find('get', '/hello').length, 1)
  })
})

describe('Get with * including JS reserved words', () => {
  const router = new api.Router()
  router.add('get', '*', 'get all')
  it('get /', () => {
    assert.strictEqual(router.find('get', '/hello/constructor').length, 1)
    assert.strictEqual(router.find('get', '/hello/__proto__').length, 1)
  })
})

describe('Basic Usage', () => {
  const router = new api.Router()
  router.add('get', '/hello', 'get hello')
  router.add('post', '/hello', 'post hello')
  router.add('get', '/hello/foo', 'get hello foo')

  it('get, post /hello', () => {
    assert.strictEqual(router.find('get', '/').length, 0)
    assert.strictEqual(router.find('post', '/').length, 0)
    assert.strictEqual(router.find('get', '/hello')[0].route.handler, 'get hello')
    assert.strictEqual(router.find('post', '/hello')[0].route.handler, 'post hello')
    assert.strictEqual(router.find('put', '/hello').length, 0)
  })
  it('get /nothing', () => {
    assert.strictEqual(router.find('get', '/nothing').length, 0)
  })
  it('/hello/foo, /hello/bar', () => {
    assert.strictEqual(router.find('get', '/hello/foo')[0].route.handler, 'get hello foo')
    assert.strictEqual(router.find('post', '/hello/foo').length, 0)
    assert.strictEqual(router.find('get', '/hello/bar').length, 0)
  })
  it('/hello/foo/bar', () => {
    assert.strictEqual(router.find('get', '/hello/foo/bar').length, 0)
  })
})

describe('Name path', () => {
  const router = new api.Router()
  router.add('get', '/entry/:id', 'get entry')
  router.add('get', '/entry/:id/comment/:comment_id', 'get comment')
  router.add('get', '/map/:location/events', 'get events')
  router.add('get', '/about/:name/address/map', 'get address')

  it('get /entry/123', () => {
    const res = router.find('get', '/entry/123')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'get entry')
    assert.ok(res[0].params)
    assert.strictEqual(res[0].params.id, '123')
    assert.notEqual(res[0].params.id, '1234')
  })

  it('get /entry/456/comment', () => {
    const res = router.find('get', '/entry/456/comment')
    assert.strictEqual(res.length, 0)
  })

  it('get /entry/789/comment/123', () => {
    const res = router.find('get', '/entry/789/comment/123')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'get comment')
    assert.strictEqual(res[0].params.id, '789')
    assert.strictEqual(res[0].params.comment_id, '123')
  })

  it('get /map/:location/events', () => {
    const res = router.find('get', '/map/yokohama/events')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'get events')
    assert.strictEqual(res[0].params.location, 'yokohama')
  })

  it('get /about/:name/address/map', () => {
    const res = router.find('get', '/about/foo/address/map')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'get address')
    assert.strictEqual(res[0].params.name, 'foo')
  })

  it('Should not return a previous param value', () => {
    const router = new api.Router()
    router.add('delete', '/resource/:id', 'resource')
    const resA = router.find('delete', '/resource/a')
    const resB = router.find('delete', '/resource/b')
    assert.ok(resA)
    assert.strictEqual(resA.length, 1)
    assert.strictEqual(resA[0].route.handler, 'resource')
    assert.deepStrictEqual(resA[0].params, { __proto__: null, id: 'a' })
    assert.ok(resB)
    assert.strictEqual(resB.length, 1)
    assert.strictEqual(resB[0].route.handler, 'resource')
    assert.deepStrictEqual(resB[0].params, { __proto__: null, id: 'b' })
  })

  it('Should return a sorted values', () => {
    const router = new api.Router()
    router.add('get', '/resource/a', 'A')
    router.add('get', '/resource/*', 'Star')
    const res = router.find('get', '/resource/a')
    assert.ok(res)
    assert.strictEqual(res.length, 2)
    assert.strictEqual(res[0].route.handler, 'A')
    assert.strictEqual(res[1].route.handler, 'Star')
  })
})

describe('Name path - Multiple route', () => {
  const router = new api.Router()

  router.add('get', '/:type/:id', 'common')
  router.add('get', '/posts/:id', 'specialized')

  it('get /posts/123', () => {
    const res = router.find('get', '/posts/123')
    assert.strictEqual(res.length, 2)
    assert.strictEqual(res[0].route.handler, 'common')
    assert.strictEqual(res[0].params.id, '123')
    assert.strictEqual(res[1].route.handler, 'specialized')
    assert.strictEqual(res[1].params.id, '123')
  })
})

describe('Param prefix', () => {
  const router = new api.Router()

  router.add('get', '/:foo', 'onepart')
  router.add('get', '/:bar/:baz', 'twopart')

  it('get /hello', () => {
    const res = router.find('get', '/hello')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'onepart')
    assert.strictEqual(res[0].params.foo, 'hello')
  })

  it('get /hello/world', () => {
    const res = router.find('get', '/hello/world')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'twopart')
    assert.strictEqual(res[0].params.bar, 'hello')
    assert.strictEqual(res[0].params.baz, 'world')
  })
})

describe('Named params and a wildcard', () => {
  const router = new api.Router()

  router.add('get', '/:id/*', 'onepart')

  it('get /', () => {
    const res = router.find('get', '/')
    assert.strictEqual(res.length, 0)
  })

  it('get /foo', () => {
    const res = router.find('get', '/foo')
    assert.strictEqual(res.length, 0)
  })

  it('get /foo/bar', () => {
    const res = router.find('get', '/foo/bar')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'onepart')
    assert.strictEqual(res[0].params.id, 'foo')
  })
})

describe('Wildcard', () => {
  const router = new api.Router()
  router.add('get', '/wildcard-abc/*/wildcard-efg', 'wildcard')
  it('/wildcard-abc/xxxxxx/wildcard-efg', () => {
    const res = router.find('get', '/wildcard-abc/xxxxxx/wildcard-efg')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'wildcard')
  })
  router.add('get', '/wildcard-abc/*/wildcard-efg/hijk', 'wildcard')
  it('/wildcard-abc/xxxxxx/wildcard-efg/hijk', () => {
    const res = router.find('get', '/wildcard-abc/xxxxxx/wildcard-efg/hijk')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'wildcard')
  })
})

describe('All', () => {
  const router = new api.Router()
  router.add('*', '/all-methods', 'all methods') // ALL
  it('/all-methods', () => {
    let res = router.find('get', '/all-methods')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'all methods')
    res = router.find('put', '/all-methods')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'all methods')
  })
})

describe('Special Wildcard', () => {
  const router = new api.Router()
  router.add('', '*', 'match all')

  it('/foo', () => {
    const res = router.find('get', '/foo')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'match all')
  })
  it('/hello', () => {
    const res = router.find('get', '/hello')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'match all')
  })
  it('/hello/foo', () => {
    const res = router.find('get', '/hello/foo')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'match all')
  })
})

describe('Special Wildcard deeply', () => {
  const router = new api.Router()
  router.add('', '/hello/*', 'match hello')
  it('/hello', () => {
    const res = router.find('get', '/hello')
    assert.strictEqual(res.length, 0)
  })
  it('/hello/foo', () => {
    const res = router.find('get', '/hello/foo')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'match hello')
  })
})

describe('Default with wildcard', () => {
  const router = new api.Router()
  router.add('', '/api/*', 'fallback')
  router.add('', '/api/abc', 'match api')
  it('/api/abc', () => {
    const res = router.find('get', '/api/abc')
    assert.strictEqual(res.length, 2)
    assert.strictEqual(res[0].route.handler, 'fallback')
    assert.strictEqual(res[1].route.handler, 'match api')
  })
  it('/api/def', () => {
    const res = router.find('get', '/api/def')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'fallback')
  })
})

describe('Multi match', () => {
  describe('Basic', () => {
    const router = new api.Router()
    router.add('get', '*', 'GET *')
    router.add('get', '/abc/*', 'GET /abc/*')
    router.add('get', '/abc/*/edf', 'GET /abc/*/edf')
    router.add('get', '/abc/edf', 'GET /abc/edf')
    router.add('get', '/abc/*/ghi/jkl', 'GET /abc/*/ghi/jkl')
    it('get /abc/edf', () => {
      const res = router.find('get', '/abc/edf')
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].route.handler, 'GET *')
      assert.strictEqual(res[1].route.handler, 'GET /abc/*')
      assert.strictEqual(res[2].route.handler, 'GET /abc/edf')
    })
    it('get /abc/xxx/edf', () => {
      const res = router.find('get', '/abc/xxx/edf')
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].route.handler, 'GET *')
      assert.strictEqual(res[1].route.handler, 'GET /abc/*')
      assert.strictEqual(res[2].route.handler, 'GET /abc/*/edf')
    })
    it('get /', () => {
      const res = router.find('get', '/')
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, 'GET *')
    })
    it('post /', () => {
      const res = router.find('post', '/')
      assert.strictEqual(res.length, 0)
    })
    it('get /abc/edf/ghi', () => {
      const res = router.find('get', '/abc/edf/ghi')
      assert.strictEqual(res.length, 2)
      assert.strictEqual(res[0].route.handler, 'GET *')
      assert.strictEqual(res[1].route.handler, 'GET /abc/*')
    })
  })
  describe('Blog', () => {
    const router = new api.Router()
    router.add('get', '*', 'middleware a')
    router.add('*', '*', 'middleware b')
    router.add('get', '/entry', 'get entries')
    router.add('post', '/entry/*', 'middleware c')
    router.add('post', '/entry', 'post entry')
    router.add('get', '/entry/:id', 'get entry')
    router.add('get', '/entry/:id/comment/:comment_id', 'get comment')
    it('get /entry/123', () => {
      const res = router.find('get', '/entry/123')
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].route.handler, 'middleware a')
      assert.strictEqual(res[0].params.id, undefined)
      assert.strictEqual(res[1].route.handler, 'middleware b')
      assert.strictEqual(res[1].params.id, undefined)
      assert.strictEqual(res[2].route.handler, 'get entry')
      assert.strictEqual(res[2].params.id, '123')
    })
    it('get /entry/123/comment/456', () => {
      const res = router.find('get', '/entry/123/comment/456')
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].route.handler, 'middleware a')
      assert.strictEqual(res[0].params.id, undefined)
      assert.strictEqual(res[0].params.comment_id, undefined)
      assert.strictEqual(res[1].route.handler, 'middleware b')
      assert.strictEqual(res[1].params.id, undefined)
      assert.strictEqual(res[1].params.comment_id, undefined)
      assert.strictEqual(res[2].route.handler, 'get comment')
      assert.strictEqual(res[2].params.id, '123')
      assert.strictEqual(res[2].params.comment_id, '456')
    })
    it('post /entry', () => {
      const res = router.find('post', '/entry')
      assert.strictEqual(res.length, 2)
      assert.strictEqual(res[0].route.handler, 'middleware b')
      assert.strictEqual(res[1].route.handler, 'post entry')
    })
    it('delete /entry', () => {
      const res = router.find('delete', '/entry')
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, 'middleware b')
    })
  })
  describe('ALL', () => {
    const router = new api.Router()
    router.add('*', '*', 'ALL *')
    router.add('', '/abc/*', 'ALL /abc/*')
    router.add('', '/abc/*/def', 'ALL /abc/*/def')
    it('get /', () => {
      const res = router.find('get', '/')
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, 'ALL *')
    })
    it('post /abc', () => {
      const res = router.find('post', '/abc')
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, 'ALL *')
    })
    it('delete /abc/xxx/def', () => {
      const res = router.find('post', '/abc/xxx/def')
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].route.handler, 'ALL *')
      assert.strictEqual(res[1].route.handler, 'ALL /abc/*')
      assert.strictEqual(res[2].route.handler, 'ALL /abc/*/def')
    })
  })
  describe('Trailing slash', () => {
    const router = new api.Router()
    router.add('get', '/book', 'GET /book')
    router.add('get', '/book/:id', 'GET /book/:id')
    it('get /book', () => {
      const res = router.find('get', '/book')
      assert.strictEqual(res.length, 1)
    })
    it('get /book/', () => {
      const res = router.find('get', '/book/')
      assert.strictEqual(res.length, 1)
    })
  })
  describe('Same path', () => {
    const router = new api.Router()
    router.add('get', '/hey', 'Middleware A')
    router.add('get', '/hey', 'Middleware B')
    it('get /hey', () => {
      const res = router.find('get', '/hey')
      assert.strictEqual(res.length, 2)
      assert.strictEqual(res[0].route.handler, 'Middleware A')
      assert.strictEqual(res[1].route.handler, 'Middleware B')
    })
  })
  describe('REST API', () => {
    const router = new api.Router()
    router.add('get', '/users/:username', 'profile')
    router.add('get', '/users/:username/posts', 'posts')
    it('get /users/123', () => {
      const res = router.find('get', '/users/123')
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, 'profile')
      assert.strictEqual(res[0].params.username, '123')
    })
    it('get /users/123/posts', () => {
      const res = router.find('get', '/users/123/posts')
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, 'posts')
      assert.strictEqual(res[0].params.username, '123')
    })
  })
})

describe('Duplicate param name', () => {
  it('self', () => {
    const router = new api.Router()
    router.add('get', '/:id/:id', 'foo')
    const res = router.find('get', '/123/456')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'foo')
    assert.strictEqual(res[0].params.id, '456')
  })

  describe('parent', () => {
    const router = new api.Router()
    router.add('get', '/:id/:action', 'foo')
    router.add('get', '/posts/:id', 'bar')
    router.add('get', '/posts/:id/comments/:comment_id', 'comment')

    it('get /123/action', () => {
      const res = router.find('get', '/123/action')
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, 'foo')
      assert.deepStrictEqual(res[0].params, { __proto__: null, id: '123', action: 'action' })
    })
  })

  it('get /posts/456 for comments', () => {
    const router = new api.Router()
    router.add('get', '/posts/:id/comments/:comment_id', 'comment')
    const res = router.find('get', '/posts/abc/comments/edf')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'comment')
    assert.deepStrictEqual(res[0].params, { __proto__: null, id: 'abc', comment_id: 'edf' })
  })

  describe('child', () => {
    const router = new api.Router()
    router.add('get', '/posts/:id', 'foo')
    router.add('get', '/:id/:action', 'bar')
    it('get /posts/action', () => {
      const res = router.find('get', '/posts/action')
      assert.strictEqual(res.length, 2)
      assert.strictEqual(res[0].route.handler, 'foo')
      assert.deepStrictEqual(res[0].params, { __proto__: null, id: 'action' })
      assert.strictEqual(res[1].route.handler, 'bar')
      assert.deepStrictEqual(res[1].params, { __proto__: null, id: 'posts', action: 'action' })
    })
  })
})

describe('Sort Order', () => {
  describe('Basic', () => {
    const router = new api.Router()
    router.add('get', '*', 'a')
    router.add('get', '/page', '/page')
    router.add('get', '/:slug', '/:slug')

    it('get /page', () => {
      const res = router.find('get', '/page')
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].route.handler, 'a')
      assert.strictEqual(res[1].route.handler, '/page')
      assert.strictEqual(res[2].route.handler, '/:slug')
    })
  })

  describe('With Named path', () => {
    const router = new api.Router()
    router.add('get', '*', 'a')
    router.add('get', '/posts/:id', '/posts/:id')
    router.add('get', '/:type/:id', '/:type/:id')

    it('get /posts/123', () => {
      const res = router.find('get', '/posts/123')
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].route.handler, 'a')
      assert.strictEqual(res[1].route.handler, '/posts/:id')
      assert.strictEqual(res[2].route.handler, '/:type/:id')
    })
  })

  describe('With Wildcards', () => {
    const router = new api.Router()
    router.add('get', '/api/*', '1st')
    router.add('get', '/api/*', '2nd')
    router.add('get', '/api/posts/:id', '3rd')
    router.add('get', '/api/*', '4th')

    it('get /api/posts/123', () => {
      const res = router.find('get', '/api/posts/123')
      assert.strictEqual(res.length, 4)
      assert.strictEqual(res[0].route.handler, '1st')
      assert.strictEqual(res[1].route.handler, '2nd')
      assert.strictEqual(res[2].route.handler, '3rd')
      assert.strictEqual(res[3].route.handler, '4th')
    })
  })

  describe('With special Wildcard', () => {
    const router = new api.Router()
    router.add('get', '/posts', '/posts')
    router.add('get', '/posts/*', '/posts/*')
    router.add('get', '/posts/:id', '/posts/:id')

    it('get /posts', () => {
      let res = router.find('get', '/posts')
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, '/posts')
      res = router.find('get', '/posts/1')
      assert.strictEqual(res.length, 2)
      assert.strictEqual(res[0].route.handler, '/posts/*')
      assert.strictEqual(res[1].route.handler, '/posts/:id')
    })
  })

  describe('Complex', () => {
    const router = new api.Router()
    router.add('get', '/api', 'a') // not match
    router.add('get', '/api/*', 'b') // match
    router.add('get', '/api/:type', 'c') // not match
    router.add('get', '/api/:type/:id', 'd') // match
    router.add('get', '/api/posts/:id', 'e') // match
    router.add('get', '/api/posts/123', 'f') // match
    router.add('get', '/*/*/:id', 'g') // match
    router.add('get', '/api/posts/*/comment', 'h') // not match
    router.add('get', '*', 'i') // match
    router.add('get', '*', 'j') // match

    it('get /api/posts/123', () => {
      const res = router.find('get', '/api/posts/123')
      assert.strictEqual(res.length, 7)
      assert.strictEqual(res[0].route.handler, 'b')
      assert.strictEqual(res[1].route.handler, 'd')
      assert.strictEqual(res[2].route.handler, 'e')
      assert.strictEqual(res[3].route.handler, 'f')
      assert.strictEqual(res[4].route.handler, 'g')
      assert.strictEqual(res[5].route.handler, 'i')
      assert.strictEqual(res[6].route.handler, 'j')
    })
  })

  describe('Multi match', () => {
    const router = new api.Router()
    router.add('get', '*', 'GET *')
    router.add('get', '/abc/*', 'GET /abc/*')
    router.add('get', '/abc/edf', 'GET /abc/edf')
    router.add('get', '/abc/*/ghi/jkl', 'GET /abc/*/ghi/jkl')
    it('get /abc/edf', () => {
      const res = router.find('get', '/abc/edf')
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].route.handler, 'GET *')
      assert.strictEqual(res[1].route.handler, 'GET /abc/*')
      assert.strictEqual(res[2].route.handler, 'GET /abc/edf')
    })
  })

  describe('Multi match', () => {
    const router = new api.Router()

    router.add('get', '/api/*', 'a')
    router.add('get', '/api/entry', 'entry')
    router.add('', '/api/*', 'b')

    it('get /api/entry', () => {
      const res = router.find('get', '/api/entry')
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].route.handler, 'a')
      assert.strictEqual(res[1].route.handler, 'entry')
      assert.strictEqual(res[2].route.handler, 'b')
    })
  })

  describe('fallback', () => {
    describe('Blog - failed', () => {
      const router = new api.Router()
      router.add('post', '/entry', 'post entry')
      router.add('post', '/entry/*', 'fallback')
      router.add('get', '/entry/:id', 'get entry')
      it('post /entry', () => {
        let res = router.find('post', '/entry');
        assert.strictEqual(res.length, 1)
        assert.strictEqual(res[0].route.handler, 'post entry')
        res = router.find('post', '/entry/1')
        assert.strictEqual(res.length, 1)
        assert.strictEqual(res[0].route.handler, 'fallback')
      })
    })
  })
  describe('page', () => {
    const router = new api.Router()
    router.add('get', '/page', 'page')
    router.add('', '/*', 'fallback')
    it('get /page', () => {
      const res = router.find('get', '/page')
      assert.strictEqual(res.length, 2)
      assert.strictEqual(res[0].route.handler, 'page')
      assert.strictEqual(res[1].route.handler, 'fallback')
    })
  })
})

describe('star', () => {
  const router = new api.Router()
  router.add('get', '/', '/')
  router.add('get', '/*', '/*')
  router.add('get', '*', '*')

  router.add('get', '/x', '/x')
  router.add('get', '/x/*', '/x/*')

  it('top', () => {
    const res = router.find('get', '/')
    assert.strictEqual(res.length, 3)
    assert.strictEqual(res[0].route.handler, '/')
    assert.strictEqual(res[1].route.handler, '/*')
    assert.strictEqual(res[2].route.handler, '*')
  })

  it('Under a certain path', () => {
    const res = router.find('get', '/x')
    assert.strictEqual(res.length, 3)
    assert.strictEqual(res[0].route.handler, '/*')
    assert.strictEqual(res[1].route.handler, '*')
    assert.strictEqual(res[2].route.handler, '/x')
  })

  it('Two levels', () => {
    const res = router.find('get', '/x/1')
    assert.strictEqual(res.length, 3)
    assert.strictEqual(res[0].route.handler, '/*')
    assert.strictEqual(res[1].route.handler, '*')
    assert.strictEqual(res[2].route.handler, '/x/*')
  })
})

describe('Routing order With named parameters', () => {
  const router = new api.Router()
  router.add('get', '/book/a', 'no-slug')
  router.add('get', '/book/:slug', 'slug')
  router.add('get', '/book/b', 'no-slug-b')
  it('/book/a', () => {
    const res = router.find('get', '/book/a')
    assert.ok(res)
    assert.strictEqual(res.length, 2)
    assert.strictEqual(res[0].route.handler, 'no-slug')
    assert.ok(!res[0].params)
    assert.strictEqual(res[1].route.handler, 'slug')
    assert.deepStrictEqual(res[1].params, { __proto__: null, slug: 'a' })
  })
  it('/book/foo', () => {
    const res = router.find('get', '/book/foo')
    assert.ok(res)
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].route.handler, 'slug')
    assert.deepStrictEqual(res[0].params, { __proto__: null, slug: 'foo' })
    assert.strictEqual(res[0].params.slug, 'foo')
  })
  it('/book/b', () => {
    const res = router.find('get', '/book/b')
    assert.ok(res)
    assert.strictEqual(res.length, 2)
    assert.strictEqual(res[0].route.handler, 'slug')
    assert.deepStrictEqual(res[0].params, { __proto__: null, slug: 'b' })
    assert.strictEqual(res[1].route.handler, 'no-slug-b')
    assert.ok(!res[1].params)
  })
})

describe('The same name is used for path params', () => {
  describe('Basic', () => {
    const router = new api.Router()
    router.add('get', '/:a/:b/:c', 'abc')
    router.add('get', '/:a/:b/:c/:d', 'abcd')
    it('/1/2/3', () => {
      const res = router.find('get', '/1/2/3')
      assert.ok(res)
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, 'abc')
      assert.deepStrictEqual(res[0].params, { __proto__: null, a: '1', b: '2', c: '3' })
    })
  })

  describe('Complex', () => {
    const router = new api.Router()
    router.add('get', '/:a', 'a')
    router.add('get', '/:b/:a', 'ba')
    it('/about/me', () => {
      const res = router.find('get', '/about/me')
      assert.ok(res)
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].route.handler, 'ba')
      assert.deepStrictEqual(res[0].params, { __proto__: null, b: 'about', a: 'me' })
    })
  })

  describe('Complex with tails', () => {
    const router = new api.Router()
    router.add('get', '/:id/:id2/comments', 'a')
    router.add('get', '/posts/:id/comments', 'b')
    it('/posts/123/comments', () => {
      const res = router.find('get', '/posts/123/comments')
      assert.ok(res)
      assert.strictEqual(res.length, 2)
      assert.strictEqual(res[0].route.handler, 'a')
      assert.deepStrictEqual(res[0].params, { __proto__: null, id: 'posts', id2: '123' })
      assert.strictEqual(res[1].route.handler, 'b')
      assert.deepStrictEqual(res[1].params, { __proto__: null, id: '123' })
    })
  })
})
