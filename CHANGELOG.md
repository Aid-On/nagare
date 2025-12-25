# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-12-25

### Added
- Initial release of @aid-on/nagare
- Core streaming functionality built on Web Streams API
- Reactive operators (map, filter, reduce, scan, etc.)
- Async operators with order preservation (mapAsync, filterAsync)
- Backpressure handling with subscribe method
- SSE (Server-Sent Events) support with cross-platform line endings
- Type-safe TypeScript implementation
- Edge runtime support (Cloudflare Workers, Deno Deploy, etc.)
- Comprehensive test suite

### Features
- ReadableStream as primary interface
- Zero dependencies
- Tree-shakeable exports
- Order-preserving concurrent processing
- Automatic backpressure control
- Dual interface support (reactive + imperative)

[0.1.0]: https://github.com/Aid-On/nagare/releases/tag/v0.1.0