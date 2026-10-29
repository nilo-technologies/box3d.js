// box3d.js — hand-written embind bindings for box3d.
//
// CONVENTIONS (the whole design in one place):
//
// * Flat & faithful. We mirror the C API ~1:1. C structs map to embind
//   value_objects; C functions bind directly. Functions taking a `const b3*Def*`
//   pointer are wrapped by a tiny by-value lambda (embind marshals value_objects
//   by value, not by pointer). Param names are embedded in the bound name string
//   ("b3Body_SetLinearVelocity(bodyId, v)") so --emit-tsd names them.
//
// * Math is mathcat-shaped plain arrays, input AND output: b3Vec3 = [x,y,z]
//   (value_array), b3Quat = [x,y,z,w] (flattened from {v,s}), b3AABB =
//   [minX,minY,minZ,maxX,maxY,maxZ], b3Transform = { position, quaternion }.
//
// * Value reads are OUT-PARAM-FIRST and zero-alloc — there is no allocating
//   returning form. Each getter is declared once with the `out_function` DSL
//   (out_desc::Vec3 / ::Quat / ::AABB descriptors), which binds a raw writer
//   `b3X_GetYInto(out, ...)` (writes floats to the static b3_getMathScratch) AND
//   records metadata into g_outRegistry / _outMeta(). src/facade.js reads
//   _outMeta() to codegen the public `b3X_GetY(out, ...) -> out` reader (copies
//   scratch into the caller's array, no per-call allocation); scripts/build.mjs
//   reads the same _outMeta() to emit the .d.ts. A b3Transform reads as two out
//   params (Vec3 position + Quat rotation), keeping every out a flat array.
//
// * ID handles (b3BodyId/etc.) stay small value_objects — opaque 64-bit handles,
//   not math, can't pack into a JS number.
//
// * Pure vec/quat/AABB math ops (b3Cross, b3MakeQuatFromAxisAngle, …) are NOT
//   bound — a quick op should never cross the wasm boundary; do it in JS.
//
// * Bulk/packed reads (contacts, per-step events, sensor overlaps, mover planes)
//   cross the boundary once as a typed-array buffer; facade.js scans them alloc-free.
//
// The file is organized into sections so it stays buildable as coverage grows.

#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <tuple>
#include <type_traits>
#include <unordered_map>
#include <utility>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <box3d/box3d.h>
#include <box3d/collision.h>

// V-HACD (convex decomposition). scripts/build.mjs stages a copy of VHACD.h whose
// worker-pool size is B3_VHACD_THREADS. Single-threaded builds have no pthreads,
// so V-HACD's threading (its worker pool and async job) is compiled out entirely.
#ifndef __EMSCRIPTEN_PTHREADS__
#define VHACD_DISABLE_THREADING 1
#endif
#define ENABLE_VHACD_IMPLEMENTATION 1
#include <VHACD.h>

#include <emscripten/em_js.h>

// Convex decomposition input errors. The messages live on the JS side because
// decoding a C++ string out of growable wasm memory fails in browsers (TextDecoder
// rejects resizable ArrayBuffers). Keep the order in sync with the message list.
enum DecompositionError
{
	e_positionsLength,
	e_indicesLength,
	e_meshTooSmall,
	e_indexRange,
	e_packedMissing,
	e_offsetsStart,
	e_offsetsOrder,
	e_offsetsLength,
	e_bodyInvalid,
	e_jobNotReady,
};
EM_JS( void, b3ThrowDecompositionError, ( int code ), {
	const messages = [
		"positions length must be a multiple of 3",
		"indices length must be a multiple of 3",
		"mesh needs at least 4 vertices and 4 triangles",
		"triangle index out of range",
		"packed decomposition is required",
		"packed offsets must start with 0",
		"packed offsets must be non-decreasing",
		"packed offsets do not match points length",
		"body is not valid",
		"convex decomposition job has not finished",
	];
	throw new Error( "box3d.js: " + messages[ code ] );
} );

using namespace emscripten;

// A captureless lambda decays to a function pointer via unary +, which is what
// embind's function() wants. Wrappers below adapt pointer-taking C functions to
// by-value value_object arguments.

namespace
{
// --- out-param math reads (see conventions in the file header) ---
// A static float scratch the facade points the raw `*Into` writers at, then copies
// out into the caller's array. 16 floats covers the largest math read (a transform).
float g_mathScratch[16];

inline void writeVec3( uintptr_t out, b3Vec3 v )
{
	float* o = reinterpret_cast<float*>( out );
	o[0] = v.x; o[1] = v.y; o[2] = v.z;
}
inline void writeQuat( uintptr_t out, b3Quat q )
{
	float* o = reinterpret_cast<float*>( out );
	o[0] = q.v.x; o[1] = q.v.y; o[2] = q.v.z; o[3] = q.s;
}
inline void writeAABB( uintptr_t out, b3AABB a )
{
	float* o = reinterpret_cast<float*>( out );
	o[0] = a.lowerBound.x; o[1] = a.lowerBound.y; o[2] = a.lowerBound.z;
	o[3] = a.upperBound.x; o[4] = a.upperBound.y; o[5] = a.upperBound.z;
}
// A b3Transform out is read as TWO out params — a Vec3 position and a Quat
// rotation — so both land as flat mathcat arrays via the generic reader (no
// composite/nested descriptor needed). See out_function below.

// ---- binding-site metadata (single source of truth) ----------------------
// The out-param value types are declared once, at the binding site, via the
// out_function DSL below. That one declaration drives BOTH the runtime reader
// install (src/facade.js reads _outMeta()) AND the emitted TypeScript types
// (scripts/build.mjs reads the same _outMeta()). Adding/editing an out
// getter needs no matching edit in facade.js or build.mjs — metadata carries it.

// One row per out-param getter, filled during EMSCRIPTEN_BINDINGS by out_function
// and published by the _outMeta() getter. `method` is the public name (no "Into"),
// `sizes` the float count of each out slot, `trailing` the count of forwarded input
// args, `tsTypes` the TS value type of each out slot (b3Vec3 / b3Quat / b3AABB).
struct OutEntry
{
	std::string method;
	std::vector<int> sizes;
	std::vector<std::string> tsTypes;
	int trailing;
};
std::vector<OutEntry> g_outRegistry;

// ---- out_function descriptor DSL ----
// Call sites read as: out_function("b3Body_GetLocalPoint(out, bodyId, p)",
//   out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId id, b3Vec3 p ){ ... });
// Each out_desc::<Type> declares an out slot of that value type; out_desc::Pass a
// forwarded input arg. Add a value type = add a Tag.
namespace out_desc
{
struct Vec3Tag { static constexpr const char* tsType = "b3Vec3"; static constexpr int size = 3; };
struct QuatTag { static constexpr const char* tsType = "b3Quat"; static constexpr int size = 4; };
struct AABBTag { static constexpr const char* tsType = "b3AABB"; static constexpr int size = 6; };

template<typename Tag> struct out_t {};
struct pass_t {};
inline constexpr pass_t Pass{};       // a forwarded (non-out) input arg
inline constexpr out_t<Vec3Tag> Vec3{};
inline constexpr out_t<QuatTag> Quat{};
inline constexpr out_t<AABBTag> AABB{};

// function-pointer arity (works with +[] non-capturing lambdas)
template<typename F> struct FnArity;
template<typename R, typename... A>
struct FnArity<R ( * )( A... )> : std::integral_constant<int, (int)sizeof...( A )> {};

// descriptor pack: count outs/trailing, collect slot sizes + TS type names
template<typename... Ds> struct DescInfo
{
	static constexpr int nOuts = 0, trailing = 0, totalSize = 0;
	static void sizes( std::vector<int>& ) {}
	static void tsTypes( std::vector<std::string>& ) {}
};
template<typename Tag, typename... Rest> struct DescInfo<out_t<Tag>, Rest...>
{
	static constexpr int nOuts = 1 + DescInfo<Rest...>::nOuts;
	static constexpr int trailing = DescInfo<Rest...>::trailing;
	static constexpr int totalSize = Tag::size + DescInfo<Rest...>::totalSize;
	static void sizes( std::vector<int>& v ) { v.push_back( Tag::size ); DescInfo<Rest...>::sizes( v ); }
	static void tsTypes( std::vector<std::string>& v ) { v.push_back( Tag::tsType ); DescInfo<Rest...>::tsTypes( v ); }
};
template<typename... Rest> struct DescInfo<pass_t, Rest...>
{
	static constexpr int nOuts = DescInfo<Rest...>::nOuts;
	static constexpr int trailing = 1 + DescInfo<Rest...>::trailing;
	static constexpr int totalSize = DescInfo<Rest...>::totalSize;
	static void sizes( std::vector<int>& v ) { DescInfo<Rest...>::sizes( v ); }
	static void tsTypes( std::vector<std::string>& v ) { DescInfo<Rest...>::tsTypes( v ); }
};
} // namespace out_desc

// Register a `<method>Into(<params>)` embind writer from a descriptor list + lambda,
// and record its metadata into g_outRegistry. The static_asserts make a mismatched
// reader a compile error rather than a runtime surprise.
template<typename Fn, typename... Descs>
void out_fn_core( const char* sig, Fn fn, Descs... )
{
	using DI = out_desc::DescInfo<Descs...>;
	// Free functions (no leading self param): lambda takes each out ptr then each
	// forwarded arg, so arity is exactly nOuts + trailing.
	static_assert( out_desc::FnArity<Fn>::value == DI::nOuts + DI::trailing,
		"out_function: lambda arity != nOuts + trailing — check descriptors vs lambda params" );
	static_assert( DI::totalSize <= 16,
		"out_function: combined out sizes exceed g_mathScratch[16] — bump it or split the getter" );
	const char* paren = strchr( sig, '(' );
	std::string method = paren ? std::string( sig, paren ) : std::string( sig );
	while ( !method.empty() && method.back() == ' ' ) method.pop_back();
	std::string intoSig = method + "Into" + ( paren ? paren : "()" );
	emscripten::function( intoSig.c_str(), fn );
	std::vector<int> szVec; DI::sizes( szVec );
	std::vector<std::string> tsVec; DI::tsTypes( tsVec );
	g_outRegistry.push_back( { method, szVec, tsVec, DI::trailing } );
}
template<typename Tup, std::size_t... I, typename Fn>
void out_fn_dispatch( const char* sig, Fn fn, const Tup& tup, std::index_sequence<I...> )
{
	out_fn_core( sig, fn, std::get<I>( tup )... );
}
// out_function("Name(out, ...)", desc..., +[lambda]) — descriptors then the lambda.
template<typename... Args>
void out_function( const char* sig, Args... args )
{
	auto tup = std::make_tuple( args... );
	constexpr std::size_t N = sizeof...( Args );
	out_fn_dispatch( sig, std::get<N - 1>( tup ), tup, std::make_index_sequence<N - 1>{} );
}

// ---- return-type override DSL ----
// A lambda returning emscripten::val emits as `any` in --emit-tsd (tsgen can't see a
// val's runtime shape). ret_function("b3GetMeshVertices(mesh): Float32Array", fn) binds
// the embind function under the name before ':' and records the real TS return type into
// g_retRegistry / _retMeta(); scripts/build.mjs retypes the `any` from that.
struct RetEntry { std::string method, tsType; };
std::vector<RetEntry> g_retRegistry;

template<typename Fn, typename... Opts>
void ret_function( const char* sig, Fn fn, Opts&&... opts )
{
	const char* colon = strchr( sig, ':' );
	std::string embSig( sig, colon ); // "b3GetMeshVertices(mesh)"
	while ( !embSig.empty() && embSig.back() == ' ' ) embSig.pop_back();
	std::string method = embSig.substr( 0, embSig.find( '(' ) );
	while ( !method.empty() && method.back() == ' ' ) method.pop_back();
	const char* ret = colon + 1;
	while ( *ret == ' ' ) ++ret; // "Float32Array"
	emscripten::function( embSig.c_str(), fn, std::forward<Opts>( opts )... );
	g_retRegistry.push_back( { method, std::string( ret ) } );
}

// Copy a POD std::vector into a JS-owned typed array. typed_memory_view aliases
// the wasm heap; the TypedArray constructor copies out of it, so the result
// stays valid after `v` (a local) is freed. One boundary crossing per tier.
inline val toI32( const std::vector<int32_t>& v )
{
	return val::global( "Int32Array" ).new_( typed_memory_view( v.size(), v.data() ) );
}
inline val toF32( const std::vector<float>& v )
{
	return val::global( "Float32Array" ).new_( typed_memory_view( v.size(), v.data() ) );
}

// ---- packed-record tier strides (single source of truth) --------------------
// These constexpr strides are THE definition: the C++ packers below use them, and
// _layoutMeta() publishes them so src/facade.js reads them instead of keeping its
// own copies (which used to drift — hence the old "MUST STAY IN SYNC" comments).
// Each stride is a sum of named field widths so adding a field is one localized,
// self-documenting edit; the per-field READ logic stays hand-written in the facade,
// only these numbers are shared. Any new stride here must be added to _layoutMeta().
namespace layout
{
constexpr int idW = 3;        // b3ShapeId/b3BodyId/b3JointId: index1, world0, generation
constexpr int contactIdW = 4; // b3ContactId: index1, world0, padding, generation
constexpr int u64W = 2;       // a uint64 packed as two int32 (lo, hi)

// contacts buffer (CSR: contacts -> manifolds -> points)
constexpr int contact = idW + idW + contactIdW + 1 + 1; // 12: idA idB contactId manifoldStart manifoldCount
constexpr int manifoldF32 = 3 + 1 + 3 + 3;              // 10: normal twistImpulse frictionImpulse rollingImpulse
constexpr int manifoldI32 = 1 + 1;                      //  2: pointStart pointCount
constexpr int pointF32 = 3 + 3 + 5;                     // 11: anchorA anchorB separation baseSeparation normalImpulse totalNormalImpulse normalVelocity
constexpr int pointI32 = 1 + 1 + 1;                     //  3: featureId triangleIndex persisted

// per-step events
constexpr int contactTouch = idW + idW + contactIdW;              // 10: shapeIdA shapeIdB contactId
constexpr int contactHitI32 = idW + idW + contactIdW + u64W + u64W; // 14: + userMaterialIdA userMaterialIdB
constexpr int contactHitF64 = 3 + 3 + 1;                          //  7: point normal approachSpeed
constexpr int bodyMoveI32 = idW + 1;                              //  4: bodyId fellAsleep
constexpr int bodyMoveF64 = 3 + 4;                                //  7: position rotation(x,y,z,w)
constexpr int sensorTouch = idW + idW;                            //  6: sensorShapeId visitorShapeId
constexpr int joint = idW;                                        //  3: jointId

// single-record query buffers
constexpr int plane = 3 + 1 + 3; // 7: plane.normal plane.offset point
constexpr int shapeId = idW;     // 3: index1 world0 generation

// debug draw. Positions are f64 because b3Pos is double when BOX3D_DOUBLE_PRECISION is on.
constexpr int debugShapeI32 = 1 + 1 + 1;       // geometryId state color
constexpr int debugShapeF64 = 3 + 4;           // position rotation(x,y,z,w)
constexpr int debugSegmentF64 = 3 + 3;         // p1 p2
constexpr int debugSegmentI32 = 1 + 1;         // color role
constexpr int debugPointF64 = 3;               // position
constexpr int debugPointF32 = 1;               // size
constexpr int debugPointI32 = 1 + 1;           // color role
constexpr int debugSphereF64 = 3;              // center
constexpr int debugSphereF32 = 1 + 1;          // radius alpha
constexpr int debugSphereI32 = 1 + 1;          // color role
constexpr int debugCapsuleF64 = 3 + 3;         // p1 p2
constexpr int debugCapsuleF32 = 1 + 1;         // radius alpha
constexpr int debugCapsuleI32 = 1 + 1;         // color role
constexpr int debugBoxF32 = 3;                 // extents
constexpr int debugBoxF64 = 3 + 4;             // position rotation
constexpr int debugBoxI32 = 1 + 1;             // color role
constexpr int debugBoundsF64 = 3 + 3;          // min max
constexpr int debugBoundsI32 = 1 + 1;          // color role
constexpr int debugTransformF64 = 3 + 4;       // position rotation
constexpr int debugTransformI32 = 1;           // role

// Tripwires: pin each stride to its known total, so changing a field width is a
// deliberate, compile-checked edit (and a nudge to reconcile the facade's field reads
// + the _layoutMeta serializer). The facade pulls the numbers themselves from
// _layoutMeta(), so it never needs updating for a value change — only for a new field.
static_assert( contact == 12 && manifoldF32 == 10 && manifoldI32 == 2 && pointF32 == 11 && pointI32 == 3,
	"contacts buffer stride changed — update the facade field reads + _layoutMeta" );
static_assert( contactTouch == 10 && contactHitI32 == 14 && contactHitF64 == 7 && bodyMoveI32 == 4
	&& bodyMoveF64 == 7 && sensorTouch == 6 && joint == 3,
	"events buffer stride changed — update the facade field reads + _layoutMeta" );
static_assert( plane == 7 && shapeId == 3,
	"plane/shapeId stride changed — update the facade field reads + _layoutMeta" );
static_assert( debugShapeI32 == 3 && debugShapeF64 == 7 && debugSegmentF64 == 6 && debugSegmentI32 == 2
	&& debugPointF64 == 3 && debugPointF32 == 1 && debugPointI32 == 2
	&& debugSphereF64 == 3 && debugSphereF32 == 2 && debugSphereI32 == 2
	&& debugCapsuleF64 == 6 && debugCapsuleF32 == 2 && debugCapsuleI32 == 2
	&& debugBoxF32 == 3 && debugBoxF64 == 7 && debugBoxI32 == 2
	&& debugBoundsF64 == 6 && debugBoundsI32 == 2
	&& debugTransformF64 == 7 && debugTransformI32 == 1,
	"debug draw stride changed — update the facade field reads + _layoutMeta" );
}

// Fill flat typed-array tiers from b3ContactData[] (CSR: contacts -> manifolds
// -> points). The vectors are cleared but keep their capacity, so a reused
// buffer grows to its high-water mark and then allocates nothing on refill.
// Tier strides come from namespace layout above.
inline void packContactsInto( const b3ContactData* data, int count,
	std::vector<int32_t>& contactsI32, std::vector<float>& manifoldsF32,
	std::vector<int32_t>& manifoldsI32, std::vector<float>& pointsF32, std::vector<int32_t>& pointsI32 )
{
	contactsI32.clear();
	manifoldsF32.clear();
	manifoldsI32.clear();
	pointsF32.clear();
	pointsI32.clear();
	contactsI32.reserve( (size_t)count * layout::contact );

	for ( int i = 0; i < count; ++i )
	{
		const b3ContactData& c = data[i];
		int manifoldStart = (int)( manifoldsI32.size() / layout::manifoldI32 );
		contactsI32.insert( contactsI32.end(), {
			c.shapeIdA.index1, c.shapeIdA.world0, c.shapeIdA.generation,
			c.shapeIdB.index1, c.shapeIdB.world0, c.shapeIdB.generation,
			c.contactId.index1, c.contactId.world0, c.contactId.padding, (int32_t)c.contactId.generation,
			manifoldStart, c.manifoldCount } );

		for ( int m = 0; m < c.manifoldCount; ++m )
		{
			const b3Manifold& man = c.manifolds[m];
			int pointStart = (int)( pointsI32.size() / layout::pointI32 );
			manifoldsF32.insert( manifoldsF32.end(), {
				man.normal.x, man.normal.y, man.normal.z, man.twistImpulse,
				man.frictionImpulse.x, man.frictionImpulse.y, man.frictionImpulse.z,
				man.rollingImpulse.x, man.rollingImpulse.y, man.rollingImpulse.z } );
			manifoldsI32.insert( manifoldsI32.end(), { pointStart, man.pointCount } );

			for ( int p = 0; p < man.pointCount; ++p )
			{
				const b3ManifoldPoint& pt = man.points[p];
				pointsF32.insert( pointsF32.end(), {
					pt.anchorA.x, pt.anchorA.y, pt.anchorA.z,
					pt.anchorB.x, pt.anchorB.y, pt.anchorB.z,
					pt.separation, pt.baseSeparation, pt.normalImpulse, pt.totalNormalImpulse, pt.normalVelocity } );
				pointsI32.insert( pointsI32.end(), {
					(int32_t)pt.featureId, pt.triangleIndex, pt.persisted ? 1 : 0 } );
			}
		}
	}
}

// A reusable buffer whose storage lives in the wasm heap and
// grows as needed. JS reads it in place through the module HEAP views (see
// src/facade.js), so refilling allocates nothing on the JS side. The caller owns
// its lifetime — createContactsBuffer() / destroyContactsBuffer() (embind
// .delete()). The *Ptr() accessors return the current wasm byte offset of each
// tier; JS must re-read them after every fill (a std::vector may reallocate as
// it grows, and memory growth swaps the HEAP views).
struct ContactsBuffer
{
	std::vector<int32_t> contactsI32, manifoldsI32, pointsI32;
	std::vector<float> manifoldsF32, pointsF32;
	int count = 0;

	void loadFromShape( b3ShapeId shapeId )
	{
		std::vector<b3ContactData> data( (size_t)b3Shape_GetContactCapacity( shapeId ) );
		count = data.empty() ? 0 : b3Shape_GetContactData( shapeId, data.data(), (int)data.size() );
		packContactsInto( data.data(), count, contactsI32, manifoldsF32, manifoldsI32, pointsF32, pointsI32 );
	}
	void loadFromBody( b3BodyId bodyId )
	{
		std::vector<b3ContactData> data( (size_t)b3Body_GetContactCapacity( bodyId ) );
		count = data.empty() ? 0 : b3Body_GetContactData( bodyId, data.data(), (int)data.size() );
		packContactsInto( data.data(), count, contactsI32, manifoldsF32, manifoldsI32, pointsF32, pointsI32 );
	}

	int getCount() const { return count; }
	unsigned contactsPtr() const { return (unsigned)(size_t)contactsI32.data(); }
	unsigned manifoldsF32Ptr() const { return (unsigned)(size_t)manifoldsF32.data(); }
	unsigned manifoldsI32Ptr() const { return (unsigned)(size_t)manifoldsI32.data(); }
	unsigned pointsF32Ptr() const { return (unsigned)(size_t)pointsF32.data(); }
	unsigned pointsI32Ptr() const { return (unsigned)(size_t)pointsI32.data(); }
};

// Reusable, wasm-backed buffer for per-step physics events. loadFrom(world)
// pulls box3d's four native event arrays (body move / sensor / contact / joint)
// into flat tiers in the wasm heap; JS reads them in place through the module
// HEAP views (see src/facade.js), so polling events each step copies nothing to
// JS and allocates no typed arrays. Each group has an i32 tier and — where it
// carries real values — an f64 tier (positions are b3Pos, which may be double;
// packing to f64 is lossless regardless of the build's precision). Tier strides are
// defined once in namespace layout above (contactTouch / contactHitI32 / contactHitF64
// / bodyMoveI32 / bodyMoveF64 / sensorTouch / joint) and published via _layoutMeta();
// the loadFrom packing order below must match the facade's hand-written field reads.
struct EventsBuffer
{
	std::vector<int32_t> contactBeginI32, contactEndI32, contactHitI32, bodyMoveI32, sensorBeginI32, sensorEndI32, jointI32;
	std::vector<double> contactHitF64, bodyMoveF64;
	int contactBeginCount = 0, contactEndCount = 0, contactHitCount = 0;
	int bodyMoveCount = 0, sensorBeginCount = 0, sensorEndCount = 0, jointCount = 0;

	static void pushShapeId( std::vector<int32_t>& v, b3ShapeId id ) { v.insert( v.end(), { id.index1, id.world0, id.generation } ); }
	static void pushContactId( std::vector<int32_t>& v, b3ContactId id ) { v.insert( v.end(), { id.index1, id.world0, id.padding, (int32_t)id.generation } ); }
	static void pushU64( std::vector<int32_t>& v, uint64_t x ) { v.insert( v.end(), { (int32_t)( x & 0xffffffffu ), (int32_t)( x >> 32 ) } ); }

	void loadFrom( b3WorldId worldId )
	{
		contactBeginI32.clear(); contactEndI32.clear(); contactHitI32.clear(); contactHitF64.clear();
		bodyMoveI32.clear(); bodyMoveF64.clear();
		sensorBeginI32.clear(); sensorEndI32.clear(); jointI32.clear();

		b3BodyEvents be = b3World_GetBodyEvents( worldId );
		bodyMoveCount = be.moveCount;
		for ( int i = 0; i < be.moveCount; ++i )
		{
			const b3BodyMoveEvent& e = be.moveEvents[i];
			bodyMoveI32.insert( bodyMoveI32.end(), { e.bodyId.index1, e.bodyId.world0, e.bodyId.generation, e.fellAsleep ? 1 : 0 } );
			bodyMoveF64.insert( bodyMoveF64.end(), {
				(double)e.transform.p.x, (double)e.transform.p.y, (double)e.transform.p.z,
				(double)e.transform.q.v.x, (double)e.transform.q.v.y, (double)e.transform.q.v.z, (double)e.transform.q.s } );
		}

		b3SensorEvents se = b3World_GetSensorEvents( worldId );
		sensorBeginCount = se.beginCount;
		for ( int i = 0; i < se.beginCount; ++i )
		{
			pushShapeId( sensorBeginI32, se.beginEvents[i].sensorShapeId );
			pushShapeId( sensorBeginI32, se.beginEvents[i].visitorShapeId );
		}
		sensorEndCount = se.endCount;
		for ( int i = 0; i < se.endCount; ++i )
		{
			pushShapeId( sensorEndI32, se.endEvents[i].sensorShapeId );
			pushShapeId( sensorEndI32, se.endEvents[i].visitorShapeId );
		}

		b3ContactEvents ce = b3World_GetContactEvents( worldId );
		contactBeginCount = ce.beginCount;
		for ( int i = 0; i < ce.beginCount; ++i )
		{
			pushShapeId( contactBeginI32, ce.beginEvents[i].shapeIdA );
			pushShapeId( contactBeginI32, ce.beginEvents[i].shapeIdB );
			pushContactId( contactBeginI32, ce.beginEvents[i].contactId );
		}
		contactEndCount = ce.endCount;
		for ( int i = 0; i < ce.endCount; ++i )
		{
			pushShapeId( contactEndI32, ce.endEvents[i].shapeIdA );
			pushShapeId( contactEndI32, ce.endEvents[i].shapeIdB );
			pushContactId( contactEndI32, ce.endEvents[i].contactId );
		}
		contactHitCount = ce.hitCount;
		for ( int i = 0; i < ce.hitCount; ++i )
		{
			const b3ContactHitEvent& e = ce.hitEvents[i];
			pushShapeId( contactHitI32, e.shapeIdA );
			pushShapeId( contactHitI32, e.shapeIdB );
			pushContactId( contactHitI32, e.contactId );
			pushU64( contactHitI32, e.userMaterialIdA );
			pushU64( contactHitI32, e.userMaterialIdB );
			contactHitF64.insert( contactHitF64.end(), {
				(double)e.point.x, (double)e.point.y, (double)e.point.z,
				(double)e.normal.x, (double)e.normal.y, (double)e.normal.z, (double)e.approachSpeed } );
		}

		b3JointEvents je = b3World_GetJointEvents( worldId );
		jointCount = je.count;
		for ( int i = 0; i < je.count; ++i )
		{
			const b3JointId id = je.jointEvents[i].jointId;
			jointI32.insert( jointI32.end(), { id.index1, id.world0, id.generation } );
		}
	}

	int getContactBeginCount() const { return contactBeginCount; }
	int getContactEndCount() const { return contactEndCount; }
	int getContactHitCount() const { return contactHitCount; }
	int getBodyMoveCount() const { return bodyMoveCount; }
	int getSensorBeginCount() const { return sensorBeginCount; }
	int getSensorEndCount() const { return sensorEndCount; }
	int getJointCount() const { return jointCount; }

	unsigned contactBeginPtr() const { return (unsigned)(size_t)contactBeginI32.data(); }
	unsigned contactEndPtr() const { return (unsigned)(size_t)contactEndI32.data(); }
	unsigned contactHitI32Ptr() const { return (unsigned)(size_t)contactHitI32.data(); }
	unsigned contactHitF64Ptr() const { return (unsigned)(size_t)contactHitF64.data(); }
	unsigned bodyMoveI32Ptr() const { return (unsigned)(size_t)bodyMoveI32.data(); }
	unsigned bodyMoveF64Ptr() const { return (unsigned)(size_t)bodyMoveF64.data(); }
	unsigned sensorBeginPtr() const { return (unsigned)(size_t)sensorBeginI32.data(); }
	unsigned sensorEndPtr() const { return (unsigned)(size_t)sensorEndI32.data(); }
	unsigned jointPtr() const { return (unsigned)(size_t)jointI32.data(); }
};

// Convert a b3LocalManifold (produced by the b3Collide* functions) to a JS
// object { normal, points: [{ point, separation }] } in shape A's local frame.
inline val localManifoldToVal( const b3LocalManifold& m )
{
	val o = val::object();
	o.set( "normal", val( m.normal ) );
	val pts = val::array();
	for ( int i = 0; i < m.pointCount; ++i )
	{
		val p = val::object();
		p.set( "point", val( m.points[i].point ) );
		p.set( "separation", m.points[i].separation );
		pts.call<void>( "push", p );
	}
	o.set( "points", pts );
	return o;
}

// Faithful debug-draw binding. b3World_Draw takes a b3DebugDraw struct of C
// function pointers; we bridge each to a method on a JS handler object carried
// through the context pointer. This crosses into JS per primitive, so it is for
// debug/inspection, NOT the render hot path (examples map shapes to solid
// meshes and only read body transforms).
struct JsDebugDraw
{
	val handlers;
};

void jsDrawSegment( b3Pos p1, b3Pos p2, b3HexColor color, void* ctx )
{
	static_cast<JsDebugDraw*>( ctx )->handlers.call<void>( "drawSegment", p1, p2, (uint32_t)color );
}
void jsDrawPoint( b3Pos p, float size, b3HexColor color, void* ctx )
{
	static_cast<JsDebugDraw*>( ctx )->handlers.call<void>( "drawPoint", p, size, (uint32_t)color );
}
void jsDrawSphere( b3Pos p, float radius, b3HexColor color, float alpha, void* ctx )
{
	static_cast<JsDebugDraw*>( ctx )->handlers.call<void>( "drawSphere", p, radius, (uint32_t)color, alpha );
}
void jsDrawCapsule( b3Pos p1, b3Pos p2, float radius, b3HexColor color, float alpha, void* ctx )
{
	static_cast<JsDebugDraw*>( ctx )->handlers.call<void>( "drawCapsule", p1, p2, radius, (uint32_t)color, alpha );
}
void jsDrawBox( b3Vec3 extents, b3WorldTransform xf, b3HexColor color, void* ctx )
{
	static_cast<JsDebugDraw*>( ctx )->handlers.call<void>( "drawBox", extents, xf, (uint32_t)color );
}
void jsDrawBounds( b3AABB aabb, b3HexColor color, void* ctx )
{
	static_cast<JsDebugDraw*>( ctx )->handlers.call<void>( "drawBounds", aabb, (uint32_t)color );
}
void jsDrawTransform( b3WorldTransform xf, void* ctx )
{
	static_cast<JsDebugDraw*>( ctx )->handlers.call<void>( "drawTransform", xf );
}

// Run b3World_Draw, dispatching primitives to methods on the JS `handlers`
// object. Only handler methods that are present get wired; flags on the same
// object (drawJoints/drawBounds/drawContacts/drawMass) select what is emitted.
void worldDraw( b3WorldId worldId, val handlers )
{
	JsDebugDraw jd{ handlers };
	b3DebugDraw dd = b3DefaultDebugDraw();
	dd.context = &jd;
	dd.drawingBounds = b3AABB{ b3Vec3{ -1e30f, -1e30f, -1e30f }, b3Vec3{ 1e30f, 1e30f, 1e30f } };

	auto has = [&]( const char* k ) { return handlers.hasOwnProperty( k ) && !handlers[k].isUndefined(); };
	auto flag = [&]( const char* k, bool dflt ) { return has( k ) ? handlers[k].as<bool>() : dflt; };

	// Only wire trampolines the caller supplied; leave the rest NULL.
	dd.DrawSegmentFcn = has( "drawSegment" ) ? jsDrawSegment : nullptr;
	dd.DrawPointFcn = has( "drawPoint" ) ? jsDrawPoint : nullptr;
	dd.DrawSphereFcn = has( "drawSphere" ) ? jsDrawSphere : nullptr;
	dd.DrawCapsuleFcn = has( "drawCapsule" ) ? jsDrawCapsule : nullptr;
	dd.DrawBoxFcn = has( "drawBox" ) ? jsDrawBox : nullptr;
	dd.DrawBoundsFcn = has( "drawBounds" ) ? jsDrawBounds : nullptr;
	dd.DrawTransformFcn = has( "drawTransform" ) ? jsDrawTransform : nullptr;
	// Shape outlines require the world-level createDebugShape cache (deferred),
	// so never let box3d call a NULL DrawShapeFcn.
	dd.DrawShapeFcn = nullptr;
	dd.DrawStringFcn = nullptr;
	dd.drawShapes = false;

	dd.drawJoints = flag( "drawJoints", dd.drawJoints );
	dd.drawBounds = flag( "drawBounds", dd.drawBounds );
	dd.drawContacts = flag( "drawContacts", dd.drawContacts );
	dd.drawMass = flag( "drawMass", dd.drawMass );

	b3World_Draw( worldId, &dd, B3_DEFAULT_MASK_BITS );
}

// ---- exact debug draw -------------------------------------------------------
// box3d only emits exact shape outlines through the world-level createDebugShape
// cache. Geometry is built once, the first time a shape is drawn, and freed from
// destroyDebugShape (shape destroy, shape change, and b3DestroyWorld all call it).
// getDebugDraw then runs one b3World_Draw pass per enabled role. A single pass
// cannot tell those roles apart: contact normals, forces, and features are
// mutually exclusive, and friction lines are the yellow primitives inside the
// contact-forces branch (drawFrictionForces itself is unread).

// Numeric values are the facade's DebugShapeState.*.value and the three module's
// state-name table. Keep this order; it mirrors b3DrawShape in physics_world.c.
enum DebugShapeState
{
	DebugShapeState_static = 0,
	DebugShapeState_kinematic,
	DebugShapeState_kinematicSleeping,
	DebugShapeState_awake,
	DebugShapeState_sleeping,
	DebugShapeState_sensor,
	DebugShapeState_disabled,
	DebugShapeState_fast,
	DebugShapeState_bullet,
	DebugShapeState_speedCapped,
	DebugShapeState_timeOfImpact,
	DebugShapeState_invalidMass,
	DebugShapeState_custom,
};

enum DebugDrawRole
{
	DebugDrawRole_bounds = 0,
	DebugDrawRole_joints,
	DebugDrawRole_mass,
	DebugDrawRole_contactPoints,
	DebugDrawRole_contactNormals,
	DebugDrawRole_contactForces,
	DebugDrawRole_frictionForces,
	DebugDrawRole_contactFeatures,
	DebugDrawRole_islands,
	DebugDrawRole_graphColors,
};

// Same packing as b3MakeDebugColor. A constexpr copy so the switch cases are
// constant expressions (the header function is inline, not constexpr).
constexpr uint32_t debugPackedColor( b3HexColor rgb, b3DebugMaterial material )
{
	return ( (uint32_t)rgb & 0x00FFFFFFu ) | ( (uint32_t)material << 24 );
}

// Counterpart of the colour choice in b3DrawShape (physics_world.c). The high
// byte is the debug material, so the match is the full packed colour. Anything
// else, including a surface customColor, is custom.
int debugShapeStateFromColor( uint32_t color )
{
	switch ( color )
	{
		case debugPackedColor( b3_colorRed, b3_debugMaterialDefault ): return DebugShapeState_invalidMass;
		case debugPackedColor( b3_colorSlateGray, b3_debugMaterialDefault ): return DebugShapeState_disabled;
		case debugPackedColor( b3_colorWheat, b3_debugMaterialDefault ): return DebugShapeState_sensor;
		case debugPackedColor( b3_colorLime, b3_debugMaterialDefault ): return DebugShapeState_timeOfImpact;
		case debugPackedColor( b3_colorTurquoise, b3_debugMaterialDefault ): return DebugShapeState_bullet;
		case debugPackedColor( b3_colorYellow, b3_debugMaterialDefault ): return DebugShapeState_speedCapped;
		case debugPackedColor( b3_colorOrange, b3_debugMaterialGlossy ): return DebugShapeState_fast;
		case debugPackedColor( b3_colorDarkGray, b3_debugMaterialMatte ): return DebugShapeState_static;
		case debugPackedColor( b3_colorSteelBlue, b3_debugMaterialMetallic ): return DebugShapeState_kinematic;
		case debugPackedColor( b3_colorLightSteelBlue, b3_debugMaterialMatte ): return DebugShapeState_kinematicSleeping;
		case debugPackedColor( b3_colorTan, b3_debugMaterialSoft ): return DebugShapeState_awake;
		case debugPackedColor( b3_colorLightSlateGray, b3_debugMaterialDead ): return DebugShapeState_sleeping;
		default: return DebugShapeState_custom;
	}
}

struct DebugGeometry
{
	uint32_t id = 0;
	std::vector<float> positions;
	std::vector<uint32_t> indices;
	std::vector<float> spheres;  // xyz + radius
	std::vector<float> capsules; // c1 xyz, c2 xyz, radius
};

std::unordered_map<uint32_t, std::unique_ptr<DebugGeometry>> g_debugGeometries;
uint32_t g_nextDebugGeometryId = 1;

void pushVec3( std::vector<float>& v, b3Vec3 p )
{
	v.insert( v.end(), { p.x, p.y, p.z } );
}

b3Vec3 scaleVec( b3Vec3 v, b3Vec3 s )
{
	return b3Vec3{ v.x * s.x, v.y * s.y, v.z * s.z };
}

void appendHull( DebugGeometry* geo, const b3HullData* hull, const b3Transform* xf )
{
	if ( hull == nullptr ) return;
	const b3Vec3* points = b3GetHullPoints( hull );
	const b3HullHalfEdge* edges = b3GetHullEdges( hull );
	const b3HullFace* faces = b3GetHullFaces( hull );
	if ( points == nullptr || edges == nullptr || faces == nullptr || hull->vertexCount <= 0 ) return;

	const uint32_t base = (uint32_t)( geo->positions.size() / 3 );
	for ( int i = 0; i < hull->vertexCount; ++i )
	{
		b3Vec3 p = xf ? b3TransformPoint( *xf, points[i] ) : points[i];
		pushVec3( geo->positions, p );
	}

	const int limit = hull->edgeCount > 0 ? hull->edgeCount : hull->vertexCount;
	for ( int faceIndex = 0; faceIndex < hull->faceCount; ++faceIndex )
	{
		const uint8_t start = faces[faceIndex].edge;
		uint8_t edgeIndex = start;
		uint32_t poly[256];
		int count = 0;
		for ( int n = 0; n < limit && count < 256; ++n )
		{
			const b3HullHalfEdge& edge = edges[edgeIndex];
			if ( edge.origin >= hull->vertexCount ) break;
			poly[count++] = base + (uint32_t)edge.origin;
			edgeIndex = edge.next;
			if ( edgeIndex == start ) break;
		}
		for ( int i = 1; i + 1 < count; ++i )
		{
			geo->indices.insert( geo->indices.end(), { poly[0], poly[i], poly[i + 1] } );
		}
	}
}

void appendMesh( DebugGeometry* geo, const b3MeshData* mesh, b3Vec3 scale, const b3Transform* xf )
{
	if ( mesh == nullptr || mesh->vertexCount <= 0 || mesh->triangleCount <= 0 ) return;
	const b3Vec3* vertices = b3GetMeshVertices( mesh );
	const b3MeshTriangle* triangles = b3GetMeshTriangles( mesh );
	if ( vertices == nullptr || triangles == nullptr ) return;

	const uint32_t base = (uint32_t)( geo->positions.size() / 3 );
	for ( int i = 0; i < mesh->vertexCount; ++i )
	{
		b3Vec3 p = scaleVec( vertices[i], scale );
		if ( xf ) p = b3TransformPoint( *xf, p );
		pushVec3( geo->positions, p );
	}
	for ( int i = 0; i < mesh->triangleCount; ++i )
	{
		const b3MeshTriangle& tri = triangles[i];
		if ( tri.index1 < 0 || tri.index2 < 0 || tri.index3 < 0 ) continue;
		geo->indices.insert( geo->indices.end(), {
			base + (uint32_t)tri.index1, base + (uint32_t)tri.index2, base + (uint32_t)tri.index3 } );
	}
}

// Same grid split as b3GetHeightFieldTriangle, which is not a public function.
// Hole cells (material 0xFF) are left out.
void appendHeightField( DebugGeometry* geo, const b3HeightFieldData* hf )
{
	if ( hf == nullptr || hf->columnCount < 2 || hf->rowCount < 2 ) return;
	const uint16_t* heights = b3GetHeightFieldCompressedHeights( hf );
	if ( heights == nullptr ) return;
	const uint8_t* materials = b3GetHeightFieldMaterialIndices( hf );

	const int columns = hf->columnCount;
	const int rows = hf->rowCount;
	const uint32_t base = (uint32_t)( geo->positions.size() / 3 );
	geo->positions.reserve( geo->positions.size() + (size_t)( columns * rows ) * 3 );
	for ( int row = 0; row < rows; ++row )
	{
		for ( int column = 0; column < columns; ++column )
		{
			const int index = row * columns + column;
			const float height = hf->minHeight + hf->heightScale * (float)heights[index];
			pushVec3( geo->positions, scaleVec( b3Vec3{ (float)column, height, (float)row }, hf->scale ) );
		}
	}

	for ( int row = 0; row < rows - 1; ++row )
	{
		for ( int column = 0; column < columns - 1; ++column )
		{
			const int cell = row * ( columns - 1 ) + column;
			if ( materials != nullptr && materials[cell] == B3_HEIGHT_FIELD_HOLE ) continue;
			const uint32_t i00 = base + (uint32_t)( row * columns + column );
			const uint32_t i10 = i00 + 1;
			const uint32_t i01 = base + (uint32_t)( ( row + 1 ) * columns + column );
			const uint32_t i11 = i01 + 1;
			geo->indices.insert( geo->indices.end(), { i00, i01, i10, i11, i10, i01 } );
		}
	}
}

void pushSphere( DebugGeometry* geo, b3Sphere sphere )
{
	geo->spheres.insert( geo->spheres.end(), { sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius } );
}

void pushCapsule( DebugGeometry* geo, b3Capsule capsule )
{
	geo->capsules.insert( geo->capsules.end(), {
		capsule.center1.x, capsule.center1.y, capsule.center1.z,
		capsule.center2.x, capsule.center2.y, capsule.center2.z,
		capsule.radius } );
}

void buildDebugGeometry( DebugGeometry* geo, const b3DebugShape* shape )
{
	switch ( shape->type )
	{
		case b3_hullShape:
			appendHull( geo, shape->hull, nullptr );
			break;
		case b3_meshShape:
			if ( shape->mesh != nullptr ) appendMesh( geo, shape->mesh->data, shape->mesh->scale, nullptr );
			break;
		case b3_heightShape:
			appendHeightField( geo, shape->heightField );
			break;
		case b3_sphereShape:
			if ( shape->sphere != nullptr ) pushSphere( geo, *shape->sphere );
			break;
		case b3_capsuleShape:
			if ( shape->capsule != nullptr ) pushCapsule( geo, *shape->capsule );
			break;
		case b3_compoundShape:
			if ( shape->compound == nullptr ) break;
			for ( int i = 0; i < shape->compound->hullCount; ++i )
			{
				b3CompoundHull child = b3GetCompoundHull( shape->compound, i );
				appendHull( geo, child.hull, &child.transform );
			}
			for ( int i = 0; i < shape->compound->meshCount; ++i )
			{
				b3CompoundMesh child = b3GetCompoundMesh( shape->compound, i );
				appendMesh( geo, child.meshData, child.scale, &child.transform );
			}
			for ( int i = 0; i < shape->compound->sphereCount; ++i )
			{
				pushSphere( geo, b3GetCompoundSphere( shape->compound, i ).sphere );
			}
			for ( int i = 0; i < shape->compound->capsuleCount; ++i )
			{
				pushCapsule( geo, b3GetCompoundCapsule( shape->compound, i ).capsule );
			}
			break;
		default:
			break;
	}
}

void* createDebugShapeCallback( const b3DebugShape* debugShape, void* )
{
	auto geo = std::make_unique<DebugGeometry>();
	geo->id = g_nextDebugGeometryId++;
	if ( g_nextDebugGeometryId == 0 ) g_nextDebugGeometryId = 1;
	buildDebugGeometry( geo.get(), debugShape );
	DebugGeometry* raw = geo.get();
	g_debugGeometries.emplace( raw->id, std::move( geo ) );
	return raw;
}

void destroyDebugShapeCallback( void* userShape, void* )
{
	if ( userShape == nullptr ) return;
	const uint32_t id = static_cast<DebugGeometry*>( userShape )->id;
	g_debugGeometries.erase( id );
}

val viewF32( const std::vector<float>& v )
{
	if ( v.empty() ) return val::global( "Float32Array" ).new_( 0 );
	return val( typed_memory_view( v.size(), v.data() ) );
}

val viewU32( const std::vector<uint32_t>& v )
{
	if ( v.empty() ) return val::global( "Uint32Array" ).new_( 0 );
	return val( typed_memory_view( v.size(), v.data() ) );
}

val getDebugGeometry( uint32_t id )
{
	auto it = g_debugGeometries.find( id );
	if ( it == g_debugGeometries.end() ) return val::null();
	const DebugGeometry* geo = it->second.get();
	val o = val::object();
	o.set( "positions", viewF32( geo->positions ) );
	o.set( "indices", viewU32( geo->indices ) );
	o.set( "spheres", viewF32( geo->spheres ) );
	o.set( "capsules", viewF32( geo->capsules ) );
	return o;
}

enum DebugPass
{
	DebugPass_shapes,
	DebugPass_bounds,
	DebugPass_joints,
	DebugPass_mass,
	DebugPass_contactPoints,
	DebugPass_contactNormals,
	DebugPass_contactForces,
	DebugPass_contactFeatures,
	DebugPass_islands,
	DebugPass_graphColors,
};

inline void pushPos( std::vector<double>& v, b3Pos p )
{
	v.insert( v.end(), { (double)p.x, (double)p.y, (double)p.z } );
}

inline void pushWorldXf( std::vector<double>& v, b3WorldTransform xf )
{
	v.insert( v.end(), {
		(double)xf.p.x, (double)xf.p.y, (double)xf.p.z,
		(double)xf.q.v.x, (double)xf.q.v.y, (double)xf.q.v.z, (double)xf.q.s } );
}

inline uint32_t rgb( b3HexColor color )
{
	return (uint32_t)color & 0x00FFFFFFu;
}

struct DebugDrawBuffer
{
	std::vector<int32_t> shapeI32, segmentI32, pointI32, sphereI32, capsuleI32, boxI32, boundsI32, transformI32;
	std::vector<float> pointF32, sphereF32, capsuleF32, boxF32;
	std::vector<double> shapeF64, segmentF64, pointF64, sphereF64, capsuleF64, boxF64, boundsF64, transformF64;

	DebugPass pass = DebugPass_shapes;
	bool keepForces = false;
	bool keepFriction = false;

	void clear()
	{
		shapeI32.clear(); shapeF64.clear();
		segmentI32.clear(); segmentF64.clear();
		pointI32.clear(); pointF32.clear(); pointF64.clear();
		sphereI32.clear(); sphereF32.clear(); sphereF64.clear();
		capsuleI32.clear(); capsuleF32.clear(); capsuleF64.clear();
		boxI32.clear(); boxF32.clear(); boxF64.clear();
		boundsI32.clear(); boundsF64.clear();
		transformI32.clear(); transformF64.clear();
	}

	void addShape( uint32_t geometryId, int state, uint32_t color, b3WorldTransform xf )
	{
		shapeI32.insert( shapeI32.end(), { (int32_t)geometryId, state, (int32_t)color } );
		pushWorldXf( shapeF64, xf );
	}
	void addSegment( b3Pos p1, b3Pos p2, uint32_t color, int role )
	{
		pushPos( segmentF64, p1 );
		pushPos( segmentF64, p2 );
		segmentI32.insert( segmentI32.end(), { (int32_t)color, role } );
	}
	void addPoint( b3Pos p, float size, uint32_t color, int role )
	{
		pushPos( pointF64, p );
		pointF32.push_back( size );
		pointI32.insert( pointI32.end(), { (int32_t)color, role } );
	}
	void addSphere( b3Pos p, float radius, float alpha, uint32_t color, int role )
	{
		pushPos( sphereF64, p );
		sphereF32.insert( sphereF32.end(), { radius, alpha } );
		sphereI32.insert( sphereI32.end(), { (int32_t)color, role } );
	}
	void addCapsule( b3Pos p1, b3Pos p2, float radius, float alpha, uint32_t color, int role )
	{
		pushPos( capsuleF64, p1 );
		pushPos( capsuleF64, p2 );
		capsuleF32.insert( capsuleF32.end(), { radius, alpha } );
		capsuleI32.insert( capsuleI32.end(), { (int32_t)color, role } );
	}
	void addBox( b3Vec3 extents, b3WorldTransform xf, uint32_t color, int role )
	{
		boxF32.insert( boxF32.end(), { extents.x, extents.y, extents.z } );
		pushWorldXf( boxF64, xf );
		boxI32.insert( boxI32.end(), { (int32_t)color, role } );
	}
	void addBounds( b3AABB aabb, uint32_t color, int role )
	{
		boundsF64.insert( boundsF64.end(), {
			(double)aabb.lowerBound.x, (double)aabb.lowerBound.y, (double)aabb.lowerBound.z,
			(double)aabb.upperBound.x, (double)aabb.upperBound.y, (double)aabb.upperBound.z } );
		boundsI32.insert( boundsI32.end(), { (int32_t)color, role } );
	}
	void addTransform( b3WorldTransform xf, int role )
	{
		pushWorldXf( transformF64, xf );
		transformI32.push_back( role );
	}

	int shapeCount() const { return (int)( shapeI32.size() / layout::debugShapeI32 ); }
	int segmentCount() const { return (int)( segmentI32.size() / layout::debugSegmentI32 ); }
	int pointCount() const { return (int)( pointI32.size() / layout::debugPointI32 ); }
	int sphereCount() const { return (int)( sphereI32.size() / layout::debugSphereI32 ); }
	int capsuleCount() const { return (int)( capsuleI32.size() / layout::debugCapsuleI32 ); }
	int boxCount() const { return (int)( boxI32.size() / layout::debugBoxI32 ); }
	int boundsCount() const { return (int)( boundsI32.size() / layout::debugBoundsI32 ); }
	int transformCount() const { return (int)( transformI32.size() / layout::debugTransformI32 ); }

	unsigned shapeI32Ptr() const { return shapeI32.empty() ? 0u : (unsigned)(size_t)shapeI32.data(); }
	unsigned shapeF64Ptr() const { return shapeF64.empty() ? 0u : (unsigned)(size_t)shapeF64.data(); }
	unsigned segmentI32Ptr() const { return segmentI32.empty() ? 0u : (unsigned)(size_t)segmentI32.data(); }
	unsigned segmentF64Ptr() const { return segmentF64.empty() ? 0u : (unsigned)(size_t)segmentF64.data(); }
	unsigned pointI32Ptr() const { return pointI32.empty() ? 0u : (unsigned)(size_t)pointI32.data(); }
	unsigned pointF32Ptr() const { return pointF32.empty() ? 0u : (unsigned)(size_t)pointF32.data(); }
	unsigned pointF64Ptr() const { return pointF64.empty() ? 0u : (unsigned)(size_t)pointF64.data(); }
	unsigned sphereI32Ptr() const { return sphereI32.empty() ? 0u : (unsigned)(size_t)sphereI32.data(); }
	unsigned sphereF32Ptr() const { return sphereF32.empty() ? 0u : (unsigned)(size_t)sphereF32.data(); }
	unsigned sphereF64Ptr() const { return sphereF64.empty() ? 0u : (unsigned)(size_t)sphereF64.data(); }
	unsigned capsuleI32Ptr() const { return capsuleI32.empty() ? 0u : (unsigned)(size_t)capsuleI32.data(); }
	unsigned capsuleF32Ptr() const { return capsuleF32.empty() ? 0u : (unsigned)(size_t)capsuleF32.data(); }
	unsigned capsuleF64Ptr() const { return capsuleF64.empty() ? 0u : (unsigned)(size_t)capsuleF64.data(); }
	unsigned boxI32Ptr() const { return boxI32.empty() ? 0u : (unsigned)(size_t)boxI32.data(); }
	unsigned boxF32Ptr() const { return boxF32.empty() ? 0u : (unsigned)(size_t)boxF32.data(); }
	unsigned boxF64Ptr() const { return boxF64.empty() ? 0u : (unsigned)(size_t)boxF64.data(); }
	unsigned boundsI32Ptr() const { return boundsI32.empty() ? 0u : (unsigned)(size_t)boundsI32.data(); }
	unsigned boundsF64Ptr() const { return boundsF64.empty() ? 0u : (unsigned)(size_t)boundsF64.data(); }
	unsigned transformI32Ptr() const { return transformI32.empty() ? 0u : (unsigned)(size_t)transformI32.data(); }
	unsigned transformF64Ptr() const { return transformF64.empty() ? 0u : (unsigned)(size_t)transformF64.data(); }

	void loadFrom( b3WorldId worldId, val options );
};

void collectDrawShape( void* userShape, b3WorldTransform xf, b3HexColor color, void* context )
{
	DebugDrawBuffer* buf = static_cast<DebugDrawBuffer*>( context );
	if ( buf == nullptr || buf->pass != DebugPass_shapes || userShape == nullptr ) return;
	const DebugGeometry* geo = static_cast<const DebugGeometry*>( userShape );
	const uint32_t packed = (uint32_t)color;
	buf->addShape( geo->id, debugShapeStateFromColor( packed ), packed, xf );
}

void collectDrawSegment( b3Pos p1, b3Pos p2, b3HexColor color, void* context )
{
	DebugDrawBuffer* buf = static_cast<DebugDrawBuffer*>( context );
	if ( buf == nullptr ) return;
	const uint32_t packed = (uint32_t)color;
	if ( buf->pass == DebugPass_joints )
	{
		buf->addSegment( p1, p2, packed, DebugDrawRole_joints );
	}
	else if ( buf->pass == DebugPass_contactNormals )
	{
		buf->addSegment( p1, p2, packed, DebugDrawRole_contactNormals );
	}
	else if ( buf->pass == DebugPass_contactForces )
	{
		// Friction is the yellow segment inside the contact-forces branch.
		// Normal impulses are magenta.
		if ( rgb( color ) == (uint32_t)b3_colorYellow )
		{
			if ( buf->keepFriction ) buf->addSegment( p1, p2, packed, DebugDrawRole_frictionForces );
		}
		else if ( buf->keepForces )
		{
			buf->addSegment( p1, p2, packed, DebugDrawRole_contactForces );
		}
	}
}

void collectDrawPoint( b3Pos p, float size, b3HexColor color, void* context )
{
	DebugDrawBuffer* buf = static_cast<DebugDrawBuffer*>( context );
	if ( buf == nullptr ) return;
	const uint32_t packed = (uint32_t)color;
	if ( buf->pass == DebugPass_graphColors )
	{
		// Contact graph points are size 10 or 15. Joint graph points are size 5.
		// Motor-joint anchors are size 8 and belong to the joints pass.
		if ( size == 5.0f || size == 10.0f || size == 15.0f )
			buf->addPoint( p, size, packed, DebugDrawRole_graphColors );
		return;
	}
	if ( buf->pass == DebugPass_contactForces )
	{
		if ( buf->keepFriction && rgb( color ) == (uint32_t)b3_colorYellow )
			buf->addPoint( p, size, packed, DebugDrawRole_frictionForces );
		return;
	}
	if ( buf->pass == DebugPass_contactPoints )
		buf->addPoint( p, size, packed, DebugDrawRole_contactPoints );
	else if ( buf->pass == DebugPass_joints )
		buf->addPoint( p, size, packed, DebugDrawRole_joints );
}

void collectDrawString( b3Pos p, const char*, b3HexColor color, void* context )
{
	DebugDrawBuffer* buf = static_cast<DebugDrawBuffer*>( context );
	if ( buf == nullptr || buf->pass != DebugPass_contactFeatures ) return;
	// Feature ids are text. A point at the anchor is what the toggle can show.
	buf->addPoint( p, 6.0f, (uint32_t)color, DebugDrawRole_contactFeatures );
}

void collectDrawSphere( b3Pos p, float radius, b3HexColor color, float alpha, void* context )
{
	DebugDrawBuffer* buf = static_cast<DebugDrawBuffer*>( context );
	if ( buf == nullptr || buf->pass != DebugPass_joints ) return;
	buf->addSphere( p, radius, alpha, (uint32_t)color, DebugDrawRole_joints );
}

void collectDrawCapsule( b3Pos p1, b3Pos p2, float radius, b3HexColor color, float alpha, void* context )
{
	DebugDrawBuffer* buf = static_cast<DebugDrawBuffer*>( context );
	if ( buf == nullptr || buf->pass != DebugPass_joints ) return;
	buf->addCapsule( p1, p2, radius, alpha, (uint32_t)color, DebugDrawRole_joints );
}

void collectDrawBox( b3Vec3 extents, b3WorldTransform xf, b3HexColor color, void* context )
{
	DebugDrawBuffer* buf = static_cast<DebugDrawBuffer*>( context );
	if ( buf == nullptr || buf->pass != DebugPass_joints ) return;
	buf->addBox( extents, xf, (uint32_t)color, DebugDrawRole_joints );
}

void collectDrawBounds( b3AABB aabb, b3HexColor color, void* context )
{
	DebugDrawBuffer* buf = static_cast<DebugDrawBuffer*>( context );
	if ( buf == nullptr ) return;
	if ( buf->pass == DebugPass_bounds )
		buf->addBounds( aabb, (uint32_t)color, DebugDrawRole_bounds );
	else if ( buf->pass == DebugPass_islands )
		buf->addBounds( aabb, (uint32_t)color, DebugDrawRole_islands );
}

void collectDrawTransform( b3WorldTransform xf, void* context )
{
	DebugDrawBuffer* buf = static_cast<DebugDrawBuffer*>( context );
	if ( buf == nullptr || buf->pass != DebugPass_mass ) return;
	buf->addTransform( xf, DebugDrawRole_mass );
}

bool readDebugFlag( val options, const char* key )
{
	val v = options[key];
	if ( v.isUndefined() || v.isNull() ) return false;
	return v.as<bool>();
}

float readDebugFloat( val options, const char* key, float fallback )
{
	val v = options[key];
	if ( v.isUndefined() || v.isNull() ) return fallback;
	return (float)v.as<double>();
}

void DebugDrawBuffer::loadFrom( b3WorldId worldId, val options )
{
	clear();
	if ( options.isUndefined() || options.isNull() ) options = val::object();

	b3AABB bounds;
	val drawingBounds = options["drawingBounds"];
	if ( drawingBounds.isUndefined() || drawingBounds.isNull() )
	{
		bounds.lowerBound = b3Vec3{ -1.0e30f, -1.0e30f, -1.0e30f };
		bounds.upperBound = b3Vec3{ 1.0e30f, 1.0e30f, 1.0e30f };
	}
	else
	{
		bounds = drawingBounds.as<b3AABB>();
	}

	uint64_t maskBits = B3_DEFAULT_MASK_BITS;
	val mask = options["maskBits"];
	if ( !mask.isUndefined() && !mask.isNull() )
	{
		const double d = mask.as<double>();
		if ( std::isfinite( d ) && d >= 0.0 ) maskBits = (uint64_t)d;
	}

	const float forceScale = readDebugFloat( options, "forceScale", 1.0f );
	const float jointScale = readDebugFloat( options, "jointScale", 1.0f );
	const bool jointExtras = readDebugFlag( options, "jointExtras" );
	keepForces = readDebugFlag( options, "contactForces" );
	keepFriction = readDebugFlag( options, "frictionForces" );

	const DebugPass passes[] = {
		DebugPass_shapes,
		DebugPass_bounds,
		DebugPass_joints,
		DebugPass_mass,
		DebugPass_contactPoints,
		DebugPass_contactNormals,
		DebugPass_contactForces,
		DebugPass_contactFeatures,
		DebugPass_islands,
		DebugPass_graphColors,
	};
	const bool enabled[] = {
		readDebugFlag( options, "shapes" ),
		readDebugFlag( options, "bounds" ),
		readDebugFlag( options, "joints" ),
		readDebugFlag( options, "mass" ),
		readDebugFlag( options, "contacts" ),
		readDebugFlag( options, "contactNormals" ),
		keepForces || keepFriction,
		readDebugFlag( options, "contactFeatures" ),
		readDebugFlag( options, "islands" ),
		readDebugFlag( options, "graphColors" ),
	};

	for ( int i = 0; i < 10; ++i )
	{
		if ( !enabled[i] ) continue;
		pass = passes[i];
		b3DebugDraw dd = b3DefaultDebugDraw();
		dd.context = this;
		dd.drawingBounds = bounds;
		dd.forceScale = forceScale;
		dd.jointScale = jointScale;
		dd.DrawShapeFcn = collectDrawShape;
		dd.DrawSegmentFcn = collectDrawSegment;
		dd.DrawPointFcn = collectDrawPoint;
		dd.DrawSphereFcn = collectDrawSphere;
		dd.DrawCapsuleFcn = collectDrawCapsule;
		dd.DrawBoxFcn = collectDrawBox;
		dd.DrawBoundsFcn = collectDrawBounds;
		dd.DrawTransformFcn = collectDrawTransform;
		dd.DrawStringFcn = collectDrawString;
		dd.drawShapes = pass == DebugPass_shapes;
		dd.drawBounds = pass == DebugPass_bounds;
		dd.drawJoints = pass == DebugPass_joints || pass == DebugPass_graphColors;
		dd.drawJointExtras = pass == DebugPass_joints && jointExtras;
		dd.drawMass = pass == DebugPass_mass;
		dd.drawContacts = pass == DebugPass_contactPoints || pass == DebugPass_contactNormals
			|| pass == DebugPass_contactForces || pass == DebugPass_contactFeatures || pass == DebugPass_graphColors;
		dd.drawContactNormals = pass == DebugPass_contactNormals;
		dd.drawContactForces = pass == DebugPass_contactForces;
		dd.drawContactFeatures = pass == DebugPass_contactFeatures;
		dd.drawGraphColors = pass == DebugPass_graphColors;
		dd.drawIslands = pass == DebugPass_islands;
		dd.drawBodyNames = false;
		b3World_Draw( worldId, &dd, maskBits );
	}
}

// ---- convex decomposition (V-HACD) ----------------------------------------
// A decomposition crosses the boundary in one packed form, both directions:
// { points: Float32Array (xyz per vertex, all pieces back to back),
//   offsets: Uint32Array (pieceCount + 1 vertex offsets; piece i = [offsets[i], offsets[i+1])) }.

[[noreturn]] void throwJsError( DecompositionError code )
{
	b3ThrowDecompositionError( code );
	__builtin_unreachable();
}

struct DecompositionOptions
{
	VHACD::IVHACD::Parameters params;
	int maxVerticesPerHull = 32;
};

DecompositionOptions readDecompositionOptions( val options )
{
	const bool hasOptions = !options.isUndefined() && !options.isNull();
	auto num = [&]( const char* key, double fallback ) -> double
	{
		val v = hasOptions ? options[key] : val::undefined();
		return v.isUndefined() ? fallback : v.as<double>();
	};
	auto flag = [&]( const char* key, bool fallback ) -> bool
	{
		val v = hasOptions ? options[key] : val::undefined();
		return v.isUndefined() ? fallback : v.as<bool>();
	};
	// Casting a double outside the uint32 range (Infinity, 1e12) is undefined
	// behaviour, so clamp first; NaN falls to the lower bound.
	auto count = [&]( const char* key, double fallback, double lo ) -> uint32_t
	{
		return (uint32_t)std::min( 4294967295.0, std::max( lo, num( key, fallback ) ) );
	};

	DecompositionOptions o;
	VHACD::IVHACD::Parameters& p = o.params;
	p.m_maxConvexHulls = count( "maxConvexHulls", 32, 1.0 );
	p.m_resolution = count( "resolution", 100000, 1000.0 );
	o.maxVerticesPerHull = (int)std::min( 255.0, std::max( 4.0, num( "maxVerticesPerHull", 32 ) ) );
	p.m_maxNumVerticesPerCH = (uint32_t)o.maxVerticesPerHull;
	p.m_minimumVolumePercentErrorAllowed = num( "minVolumePercentError", 1.0 );
	p.m_maxRecursionDepth = count( "maxRecursionDepth", 10, 1.0 );
	p.m_shrinkWrap = flag( "shrinkWrap", true );
#ifdef __EMSCRIPTEN_PTHREADS__
	p.m_asyncACD = flag( "useThreads", false );
#else
	p.m_asyncACD = false;
#endif
	return o;
}

// Mesh input copied out of JS and checked up front: V-HACD does not bounds-check
// triangle indices, so a bad index would read out of bounds inside the voxelizer.
struct DecompositionMesh
{
	std::vector<float> positions;
	std::vector<uint32_t> indices;
};

DecompositionMesh readDecompositionMesh( val positions, val indices )
{
	DecompositionMesh m;
	m.positions = convertJSArrayToNumberVector<float>( positions );
	m.indices = convertJSArrayToNumberVector<uint32_t>( indices );
	if ( m.positions.size() % 3 != 0 ) throwJsError( e_positionsLength );
	if ( m.indices.size() % 3 != 0 ) throwJsError( e_indicesLength );
	if ( m.positions.size() < 12 || m.indices.size() < 12 ) throwJsError( e_meshTooSmall );
	const uint32_t vertexCount = (uint32_t)( m.positions.size() / 3 );
	for ( uint32_t i : m.indices )
	{
		if ( i >= vertexCount ) throwJsError( e_indexRange );
	}
	return m;
}

struct DecompositionPieces
{
	std::vector<float> points;
	std::vector<uint32_t> offsets{ 0 };
};

DecompositionPieces collectPieces( VHACD::IVHACD* vhacd )
{
	DecompositionPieces out;
	for ( uint32_t i = 0, n = vhacd->GetNConvexHulls(); i < n; ++i )
	{
		VHACD::IVHACD::ConvexHull ch;
		if ( !vhacd->GetConvexHull( i, ch ) ) continue;
		for ( const VHACD::Vertex& v : ch.m_points )
		{
			out.points.insert( out.points.end(), { (float)v.mX, (float)v.mY, (float)v.mZ } );
		}
		out.offsets.push_back( (uint32_t)( out.points.size() / 3 ) );
	}
	return out;
}

DecompositionPieces runDecomposition( const DecompositionMesh& mesh, const DecompositionOptions& opts )
{
	VHACD::IVHACD* vhacd = VHACD::CreateVHACD();
	vhacd->Compute( mesh.positions.data(), (uint32_t)( mesh.positions.size() / 3 ), mesh.indices.data(),
		(uint32_t)( mesh.indices.size() / 3 ), opts.params );
	DecompositionPieces pieces = collectPieces( vhacd );
	vhacd->Clean();
	vhacd->Release();
	return pieces;
}

DecompositionPieces readPacked( val packed )
{
	if ( packed.isUndefined() || packed.isNull() ) throwJsError( e_packedMissing );
	DecompositionPieces p;
	p.points = convertJSArrayToNumberVector<float>( packed["points"] );
	p.offsets = convertJSArrayToNumberVector<uint32_t>( packed["offsets"] );
	if ( p.offsets.empty() || p.offsets[0] != 0 ) throwJsError( e_offsetsStart );
	for ( size_t i = 1; i < p.offsets.size(); ++i )
	{
		if ( p.offsets[i] < p.offsets[i - 1] ) throwJsError( e_offsetsOrder );
	}
	if ( (size_t)p.offsets.back() * 3 != p.points.size() ) throwJsError( e_offsetsLength );
	return p;
}

val toPacked( const DecompositionPieces& p )
{
	val out = val::object();
	out.set( "points", toF32( p.points ) );
	out.set( "offsets", val::global( "Uint32Array" ).new_( typed_memory_view( p.offsets.size(), p.offsets.data() ) ) );
	return out;
}

int readMaxVertices( val maxVerticesPerHull )
{
	if ( maxVerticesPerHull.isUndefined() || maxVerticesPerHull.isNull() ) return 32;
	return (int)std::min( 255.0, std::max( 4.0, maxVerticesPerHull.as<double>() ) );
}

// box3d caps hull vertices, faces and half-edges at 255, so a piece can fail at
// its own size yet succeed once b3CreateHull simplifies it to a smaller budget.
b3HullData* buildHullWithRetry( const float* points, int count, int maxVertices )
{
	if ( count < 4 ) return nullptr;
	const b3Vec3* pts = reinterpret_cast<const b3Vec3*>( points );
	int last = std::min( count, maxVertices );
	if ( b3HullData* hull = b3CreateHull( pts, count, last ) ) return hull;
	for ( int budget : { 32, 24, 16, 8 } )
	{
		if ( budget >= last ) continue;
		last = budget;
		if ( b3HullData* hull = b3CreateHull( pts, count, budget ) ) return hull;
	}
	return nullptr;
}

// Returns { count, data: Int32Array (3 int32 per shape id), skipped }: the
// ShapeIdBuffer layout, read with getNumShapeIds / getShapeIdAt.
val attachHullShapes( b3BodyId bodyId, const b3ShapeDef& def, const DecompositionPieces& pieces, int maxVertices )
{
	if ( !b3Body_IsValid( bodyId ) ) throwJsError( e_bodyInvalid );
	std::vector<int32_t> ids;
	int skipped = 0;
	const size_t pieceCount = pieces.offsets.size() - 1;
	ids.reserve( pieceCount * layout::shapeId );
	for ( size_t i = 0; i < pieceCount; ++i )
	{
		const uint32_t begin = pieces.offsets[i];
		const int count = (int)( pieces.offsets[i + 1] - begin );
		b3HullData* hull = buildHullWithRetry( pieces.points.data() + (size_t)begin * 3, count, maxVertices );
		if ( hull == nullptr )
		{
			++skipped;
			continue;
		}
		b3ShapeId id = b3CreateHullShape( bodyId, &def, hull );
		b3DestroyHull( hull );
		if ( id.index1 == 0 )
		{
			++skipped;
			continue;
		}
		ids.insert( ids.end(), { id.index1, id.world0, id.generation } );
	}
	val out = val::object();
	out.set( "count", (int)( ids.size() / layout::shapeId ) );
	out.set( "data", toI32( ids ) );
	out.set( "skipped", skipped );
	return out;
}

#ifdef __EMSCRIPTEN_PTHREADS__
// Background decomposition for the facade's Promise variants. V-HACD's async
// implementation copies the mesh at start and runs it on its own thread; the
// destructor cancels and joins that thread, so deleting a running job is safe.
class ConvexDecompositionJob
{
public:
	ConvexDecompositionJob() : m_vhacd( VHACD::CreateVHACD_ASYNC() ) {}
	~ConvexDecompositionJob()
	{
		m_vhacd->Clean();
		m_vhacd->Release();
	}

	void start( val positions, val indices, val options )
	{
		DecompositionMesh mesh = readDecompositionMesh( positions, indices );
		DecompositionOptions opts = readDecompositionOptions( options );
		m_vhacd->Compute( mesh.positions.data(), (uint32_t)( mesh.positions.size() / 3 ), mesh.indices.data(),
			(uint32_t)( mesh.indices.size() / 3 ), opts.params );
	}

	bool isReady() const { return m_vhacd->IsReady(); }
	val takeResult() const
	{
		if ( !m_vhacd->IsReady() ) throwJsError( e_jobNotReady );
		return toPacked( collectPieces( m_vhacd ) );
	}

private:
	VHACD::IVHACD* m_vhacd;
};
#endif

// --- friction / restitution mixing rules ---
// Native callbacks installed by b3World_SetMixingRules. box3d calls them from solver
// worker threads with no context pointer, so each rule is a stateless free function
// (safe in the MT build, no JS call per contact). Order matches the b3MixingRule
// constants in src/facade.js.
enum MixingRule
{
	e_mixGeometric,
	e_mixAverage,
	e_mixMin,
	e_mixMax,
	e_mixMultiply,
	e_mixWeighted,
	e_mixRuleCount,
};

// Per-shape weights packed into b3SurfaceMaterial::userMaterialId, so the weighted rule takes
// that field over (it can't also tag materials while this rule is active):
// bits 0-31 friction weight * 1000 (uint32), bits 32-62 restitution weight * 1000 (31 bits),
// bit 63 set = weights present. The mixed value is (a*wA + b*wB) / (wA + wB), a plain average
// when both weights are 0. A shape without the presence bit uses box3d's default rule for the pair.
constexpr uint64_t kWeightsPresent = 1ull << 63;

inline bool hasWeights( uint64_t id ) { return ( id & kWeightsPresent ) != 0; }
inline float frictionWeight( uint64_t id ) { return (float)(uint32_t)id * 0.001f; }
inline float restitutionWeight( uint64_t id ) { return (float)(uint32_t)( ( id >> 32 ) & 0x7FFFFFFFu ) * 0.001f; }

inline float weightedMix( float a, float wA, float b, float wB )
{
	float w = wA + wB;
	return w > 0.0f ? ( a * wA + b * wB ) / w : 0.5f * ( a + b );
}

float mixFrictionGeometric( float a, uint64_t, float b, uint64_t ) { return sqrtf( a * b ); }
float mixFrictionAverage( float a, uint64_t, float b, uint64_t ) { return 0.5f * ( a + b ); }
float mixFrictionMin( float a, uint64_t, float b, uint64_t ) { return std::min( a, b ); }
float mixFrictionMax( float a, uint64_t, float b, uint64_t ) { return std::max( a, b ); }
float mixFrictionMultiply( float a, uint64_t, float b, uint64_t ) { return a * b; }
float mixFrictionWeighted( float a, uint64_t idA, float b, uint64_t idB )
{
	if ( !hasWeights( idA ) || !hasWeights( idB ) ) return sqrtf( a * b );
	return weightedMix( a, frictionWeight( idA ), b, frictionWeight( idB ) );
}

float mixRestitutionGeometric( float a, uint64_t, float b, uint64_t ) { return sqrtf( a * b ); }
float mixRestitutionAverage( float a, uint64_t, float b, uint64_t ) { return 0.5f * ( a + b ); }
float mixRestitutionMin( float a, uint64_t, float b, uint64_t ) { return std::min( a, b ); }
float mixRestitutionMax( float a, uint64_t, float b, uint64_t ) { return std::max( a, b ); }
float mixRestitutionMultiply( float a, uint64_t, float b, uint64_t ) { return a * b; }
float mixRestitutionWeighted( float a, uint64_t idA, float b, uint64_t idB )
{
	if ( !hasWeights( idA ) || !hasWeights( idB ) ) return std::max( a, b );
	return weightedMix( a, restitutionWeight( idA ), b, restitutionWeight( idB ) );
}

b3FrictionCallback* const g_frictionRules[e_mixRuleCount] = {
	mixFrictionGeometric, mixFrictionAverage, mixFrictionMin, mixFrictionMax, mixFrictionMultiply, mixFrictionWeighted,
};
b3RestitutionCallback* const g_restitutionRules[e_mixRuleCount] = {
	mixRestitutionGeometric, mixRestitutionAverage, mixRestitutionMin,
	mixRestitutionMax, mixRestitutionMultiply, mixRestitutionWeighted,
};

EM_JS( void, b3ThrowMixingRuleError, ( int rule ), {
	throw new RangeError( "box3d.js: unknown mixing rule " + rule + " (use a b3MixingRule value)" );
} );

void setMixingRules( b3WorldId worldId, int frictionRule, int restitutionRule )
{
	if ( frictionRule < 0 || frictionRule >= e_mixRuleCount ) b3ThrowMixingRuleError( frictionRule );
	if ( restitutionRule < 0 || restitutionRule >= e_mixRuleCount ) b3ThrowMixingRuleError( restitutionRule );
	b3World_SetFrictionCallback( worldId, g_frictionRules[frictionRule] );
	b3World_SetRestitutionCallback( worldId, g_restitutionRules[restitutionRule] );
}

// --- persistent (constant) body forces ---
// box3d clears forces after every step and drops ApplyForce(wake=false) on a sleeping
// body. This side table, one map per world slot keyed by body index, holds forces and
// torques set once; the b3World_Step binding re-applies them (wake=false) before each
// step. Entries die with the body: b3DestroyBody erases them, b3DestroyWorld clears the
// world's table, and a stale id found at step time is dropped.
struct ConstantForce
{
	b3BodyId bodyId;
	b3Vec3 force;
	b3Vec3 localPoint; // force application point in body coordinates
	b3Vec3 torque;
	bool hasForce;
	bool atCenter;
	bool hasTorque;
};

std::unordered_map<int32_t, ConstantForce> g_constantForces[B3_MAX_WORLDS];

inline bool isZero( b3Vec3 v ) { return v.x == 0.0f && v.y == 0.0f && v.z == 0.0f; }

ConstantForce& constantForceEntry( b3BodyId bodyId )
{
	ConstantForce& entry = g_constantForces[bodyId.world0][bodyId.index1];
	if ( entry.bodyId.index1 != bodyId.index1 || entry.bodyId.generation != bodyId.generation )
	{
		// fresh entry, or a stale one left by a destroyed body that reused this slot
		entry = ConstantForce{};
		entry.bodyId = bodyId;
	}
	return entry;
}

void eraseConstantForceIfEmpty( b3BodyId bodyId )
{
	auto& table = g_constantForces[bodyId.world0];
	auto it = table.find( bodyId.index1 );
	if ( it != table.end() && it->second.hasForce == false && it->second.hasTorque == false ) table.erase( it );
}

void setConstantForce( b3BodyId bodyId, b3Vec3 force, val point )
{
	if ( !b3Body_IsValid( bodyId ) ) throwJsError( e_bodyInvalid );
	ConstantForce& entry = constantForceEntry( bodyId );
	entry.hasForce = !isZero( force );
	entry.force = force;
	entry.atCenter = point.isNull() || point.isUndefined();
	entry.localPoint = entry.atCenter ? b3Vec3{ 0.0f, 0.0f, 0.0f } : point.as<b3Vec3>();
	eraseConstantForceIfEmpty( bodyId );
	if ( !isZero( force ) ) b3Body_SetAwake( bodyId, true );
}

void setConstantTorque( b3BodyId bodyId, b3Vec3 torque )
{
	if ( !b3Body_IsValid( bodyId ) ) throwJsError( e_bodyInvalid );
	ConstantForce& entry = constantForceEntry( bodyId );
	entry.hasTorque = !isZero( torque );
	entry.torque = torque;
	eraseConstantForceIfEmpty( bodyId );
	if ( !isZero( torque ) ) b3Body_SetAwake( bodyId, true );
}

// Called with unvalidated ids (b3DestroyBody, b3Body_ClearConstantForces), so range-check the
// world slot before indexing the fixed table.
void clearConstantForces( b3BodyId bodyId )
{
	if ( bodyId.world0 >= B3_MAX_WORLDS ) return;
	auto& table = g_constantForces[bodyId.world0];
	auto it = table.find( bodyId.index1 );
	if ( it != table.end() && it->second.bodyId.generation == bodyId.generation ) table.erase( it );
}

void applyConstantForces( b3WorldId worldId )
{
	auto& table = g_constantForces[worldId.index1 - 1];
	for ( auto it = table.begin(); it != table.end(); )
	{
		const ConstantForce& entry = it->second;
		if ( !b3Body_IsValid( entry.bodyId ) )
		{
			it = table.erase( it );
			continue;
		}
		if ( entry.hasForce )
		{
			if ( entry.atCenter ) b3Body_ApplyForceToCenter( entry.bodyId, entry.force, false );
			else b3Body_ApplyForce( entry.bodyId, entry.force, b3Body_GetWorldPoint( entry.bodyId, entry.localPoint ), false );
		}
		if ( entry.hasTorque ) b3Body_ApplyTorque( entry.bodyId, entry.torque, false );
		++it;
	}
}

// --- packed body transforms ---
// ids: Int32Array of (index1, world0, generation) triples. Returns a fresh Float64Array,
// 7 per body: px py pz qx qy qz qw. An invalid id reads as NaN so a stale handle never
// aborts the module.
constexpr int kPackedTransformStride = 7;

val getBodyTransformsPacked( val ids )
{
	std::vector<int32_t> packedIds = convertJSArrayToNumberVector<int32_t>( ids );
	size_t count = packedIds.size() / 3;
	std::vector<double> out( count * kPackedTransformStride );
	for ( size_t i = 0; i < count; ++i )
	{
		b3BodyId bodyId = { packedIds[3 * i], (uint16_t)packedIds[3 * i + 1], (uint16_t)packedIds[3 * i + 2] };
		double* o = out.data() + i * kPackedTransformStride;
		if ( !b3Body_IsValid( bodyId ) )
		{
			std::fill( o, o + kPackedTransformStride, NAN );
			continue;
		}
		b3Transform t = b3Body_GetTransform( bodyId );
		o[0] = t.p.x; o[1] = t.p.y; o[2] = t.p.z;
		o[3] = t.q.v.x; o[4] = t.q.v.y; o[5] = t.q.v.z; o[6] = t.q.s;
	}
	val result = val::global( "Float64Array" ).new_( out.size() );
	result.call<void>( "set", val( typed_memory_view( out.size(), out.data() ) ) );
	return result;
}

// --- natively filtered queries ---
// b3QueryOptions { ignoreBodies?, ignoreShapes?: Int32Array of (index1, world0, generation)
// triples, excludeSensors?: boolean }. The skip test runs inside the box3d query callback,
// so filtering a candidate never calls into JS (each JS callback is a sandbox crossing).
struct QueryOptions
{
	std::vector<int32_t> ignoreBodies;
	std::vector<int32_t> ignoreShapes;
	bool excludeSensors = false;

	static bool listed( const std::vector<int32_t>& triples, int32_t index1, int32_t world0, int32_t generation )
	{
		for ( size_t i = 0; i + 2 < triples.size(); i += 3 )
		{
			if ( triples[i] == index1 && triples[i + 1] == world0 && triples[i + 2] == generation ) return true;
		}
		return false;
	}

	bool skips( b3ShapeId shapeId ) const
	{
		if ( listed( ignoreShapes, shapeId.index1, shapeId.world0, shapeId.generation ) ) return true;
		if ( !ignoreBodies.empty() )
		{
			b3BodyId bodyId = b3Shape_GetBody( shapeId );
			if ( listed( ignoreBodies, bodyId.index1, bodyId.world0, bodyId.generation ) ) return true;
		}
		return excludeSensors && b3Shape_IsSensor( shapeId );
	}
};

QueryOptions readQueryOptions( val options )
{
	QueryOptions q;
	if ( options.isUndefined() || options.isNull() ) return q;
	val bodies = options["ignoreBodies"];
	if ( !bodies.isUndefined() && !bodies.isNull() ) q.ignoreBodies = convertJSArrayToNumberVector<int32_t>( bodies );
	val shapes = options["ignoreShapes"];
	if ( !shapes.isUndefined() && !shapes.isNull() ) q.ignoreShapes = convertJSArrayToNumberVector<int32_t>( shapes );
	val sensors = options["excludeSensors"];
	q.excludeSensors = !sensors.isUndefined() && !sensors.isNull() && sensors.as<bool>();
	return q;
}

val toF64( const std::vector<double>& v )
{
	val result = val::global( "Float64Array" ).new_( v.size() );
	if ( !v.empty() ) result.call<void>( "set", val( typed_memory_view( v.size(), v.data() ) ) );
	return result;
}

inline void pushShapeAndBody( std::vector<double>& out, b3ShapeId shapeId, b3BodyId bodyId )
{
	out.insert( out.end(), { (double)shapeId.index1, (double)shapeId.world0, (double)shapeId.generation, (double)bodyId.index1,
							 (double)bodyId.world0, (double)bodyId.generation } );
}

// Stride 14: shape id(3), body id(3), body type, plane normal(3), plane offset, point(3) relative to origin.
constexpr int kMoverPlaneStride = 6 + 1 + 4 + 3;
static_assert( kMoverPlaneStride == 14, "b3World_CollideMoverPacked stride is part of the public contract" );

val collideMoverPacked( b3WorldId worldId, b3Vec3 origin, b3Capsule mover, b3QueryFilter filter, val options )
{
	struct Context
	{
		QueryOptions options;
		std::vector<double> out;
	} context{ readQueryOptions( options ), {} };

	b3World_CollideMover( worldId, origin, &mover, filter,
		[]( b3ShapeId shapeId, const b3PlaneResult* planes, int planeCount, void* ctx ) -> bool
		{
			Context* c = static_cast<Context*>( ctx );
			if ( c->options.skips( shapeId ) ) return true;
			b3BodyId bodyId = b3Shape_GetBody( shapeId );
			double bodyType = (double)b3Body_GetType( bodyId );
			for ( int i = 0; i < planeCount; ++i )
			{
				const b3PlaneResult& pr = planes[i];
				pushShapeAndBody( c->out, shapeId, bodyId );
				c->out.insert( c->out.end(), { bodyType, (double)pr.plane.normal.x, (double)pr.plane.normal.y,
											   (double)pr.plane.normal.z, (double)pr.plane.offset, (double)pr.point.x,
											   (double)pr.point.y, (double)pr.point.z } );
			}
			return true;
		},
		&context );
	return toF64( context.out );
}

float castMoverFiltered( b3WorldId worldId, b3Vec3 origin, b3Capsule mover, b3Vec3 translation, b3QueryFilter filter, val options )
{
	QueryOptions q = readQueryOptions( options );
	return b3World_CastMover( worldId, origin, &mover, translation, filter,
		[]( b3ShapeId shapeId, void* ctx ) -> bool { return static_cast<QueryOptions*>( ctx )->skips( shapeId ) == false; }, &q );
}

// Closest-hit cast state: 14 numbers when hit, shape id(3), body id(3), point(3), normal(3), fraction, spare 0.
constexpr int kClosestHitStride = 14;

struct ClosestHitContext
{
	QueryOptions options;
	bool hit = false;
	b3ShapeId shapeId = {};
	b3Pos point = {};
	b3Vec3 normal = {};
	float fraction = 1.0f;
};

float closestHitCallback( b3ShapeId shapeId, b3Pos point, b3Vec3 normal, float fraction, uint64_t, int, int, void* ctx )
{
	ClosestHitContext* c = static_cast<ClosestHitContext*>( ctx );
	if ( c->options.skips( shapeId ) ) return -1.0f;
	c->hit = true;
	c->shapeId = shapeId;
	c->point = point;
	c->normal = normal;
	c->fraction = fraction;
	// clip the cast so only closer hits are reported from here on
	return fraction;
}

val packClosestHit( const ClosestHitContext& c )
{
	std::vector<double> out;
	if ( c.hit )
	{
		out.reserve( kClosestHitStride );
		pushShapeAndBody( out, c.shapeId, b3Shape_GetBody( c.shapeId ) );
		out.insert( out.end(), { (double)c.point.x, (double)c.point.y, (double)c.point.z, (double)c.normal.x, (double)c.normal.y,
								 (double)c.normal.z, (double)c.fraction, 0.0 } );
	}
	return toF64( out );
}

val castRayClosestFiltered( b3WorldId worldId, b3Vec3 origin, b3Vec3 translation, b3QueryFilter filter, val options )
{
	ClosestHitContext c;
	c.options = readQueryOptions( options );
	b3World_CastRay( worldId, origin, translation, filter, closestHitCallback, &c );
	return packClosestHit( c );
}

val castShapeClosestFiltered( b3WorldId worldId, b3Vec3 origin, val points, float radius, b3Vec3 translation, b3QueryFilter filter,
							  val options )
{
	std::vector<float> f = convertJSArrayToNumberVector<float>( points );
	b3ShapeProxy proxy{ reinterpret_cast<const b3Vec3*>( f.data() ), (int)( f.size() / 3 ), radius };
	ClosestHitContext c;
	c.options = readQueryOptions( options );
	b3World_CastShape( worldId, origin, &proxy, translation, filter, closestHitCallback, &c );
	return packClosestHit( c );
}

// --- shape hull swap ---
// Bakes transform/scale into a fresh hull (as b3CreateTransformedHullShape does), swaps
// it into the shape (the world keeps its own copy), and optionally recomputes the body
// mass. Returns false, leaving the shape unchanged, if the transformed hull is degenerate.
bool setShapeBakedHull( b3ShapeId shapeId, const b3HullData* hull, b3Transform transform, b3Vec3 scale, bool updateBodyMass )
{
	b3HullData* baked = b3CloneAndTransformHull( hull, transform, scale );
	if ( baked == nullptr ) return false;
	b3Shape_SetHull( shapeId, baked );
	b3DestroyHull( baked );
	if ( updateBodyMass ) b3Body_ApplyMassFromShapes( b3Shape_GetBody( shapeId ) );
	return true;
}
} // namespace

EMSCRIPTEN_BINDINGS( box3d )
{
	value_object<b3Version>( "Version" )
		.field( "major", &b3Version::major )
		.field( "minor", &b3Version::minor )
		.field( "revision", &b3Version::revision );

	function( "b3GetVersion()", &b3GetVersion );
	function( "b3IsDoublePrecision()", &b3IsDoublePrecision );
	function( "b3GetByteCount()", &b3GetByteCount );

	enum_<b3BodyType>( "b3BodyType" )
		.value( "b3_staticBody", b3_staticBody )
		.value( "b3_kinematicBody", b3_kinematicBody )
		.value( "b3_dynamicBody", b3_dynamicBody );

	enum_<b3ShapeType>( "b3ShapeType" )
		.value( "b3_capsuleShape", b3_capsuleShape )
		.value( "b3_compoundShape", b3_compoundShape )
		.value( "b3_heightShape", b3_heightShape )
		.value( "b3_hullShape", b3_hullShape )
		.value( "b3_meshShape", b3_meshShape )
		.value( "b3_sphereShape", b3_sphereShape );

	enum_<DebugShapeState>( "DebugShapeState" )
		.value( "static", DebugShapeState_static )
		.value( "kinematic", DebugShapeState_kinematic )
		.value( "kinematicSleeping", DebugShapeState_kinematicSleeping )
		.value( "awake", DebugShapeState_awake )
		.value( "sleeping", DebugShapeState_sleeping )
		.value( "sensor", DebugShapeState_sensor )
		.value( "disabled", DebugShapeState_disabled )
		.value( "fast", DebugShapeState_fast )
		.value( "bullet", DebugShapeState_bullet )
		.value( "speedCapped", DebugShapeState_speedCapped )
		.value( "timeOfImpact", DebugShapeState_timeOfImpact )
		.value( "invalidMass", DebugShapeState_invalidMass )
		.value( "custom", DebugShapeState_custom );

	enum_<DebugDrawRole>( "DebugDrawRole" )
		.value( "bounds", DebugDrawRole_bounds )
		.value( "joints", DebugDrawRole_joints )
		.value( "mass", DebugDrawRole_mass )
		.value( "contactPoints", DebugDrawRole_contactPoints )
		.value( "contactNormals", DebugDrawRole_contactNormals )
		.value( "contactForces", DebugDrawRole_contactForces )
		.value( "frictionForces", DebugDrawRole_frictionForces )
		.value( "contactFeatures", DebugDrawRole_contactFeatures )
		.value( "islands", DebugDrawRole_islands )
		.value( "graphColors", DebugDrawRole_graphColors );

	enum_<b3JointType>( "b3JointType" )
		.value( "b3_parallelJoint", b3_parallelJoint )
		.value( "b3_distanceJoint", b3_distanceJoint )
		.value( "b3_filterJoint", b3_filterJoint )
		.value( "b3_motorJoint", b3_motorJoint )
		.value( "b3_prismaticJoint", b3_prismaticJoint )
		.value( "b3_revoluteJoint", b3_revoluteJoint )
		.value( "b3_sphericalJoint", b3_sphericalJoint )
		.value( "b3_weldJoint", b3_weldJoint )
		.value( "b3_wheelJoint", b3_wheelJoint )
		.value( "b3_moverJoint", b3_moverJoint )
		.value( "b3_pogoJoint", b3_pogoJoint )
		.value( "b3_vehicleWheelJoint", b3_vehicleWheelJoint )
		.value( "b3_cylindricalJoint", b3_cylindricalJoint );

	// Math value types are mathcat-shaped plain arrays (see file header).
	// b3Vec3 -> [x,y,z], b3Quat -> [x,y,z,w], b3AABB -> [minX,minY,minZ,maxX,maxY,maxZ].
	value_array<b3Vec3>( "b3Vec3" )
		.element( &b3Vec3::x )
		.element( &b3Vec3::y )
		.element( &b3Vec3::z );

	// b3Quat is { v: b3Vec3, s } in C; flatten to [x,y,z,w].
	value_array<b3Quat>( "b3Quat" )
		.element( +[]( const b3Quat& q ) { return q.v.x; }, +[]( b3Quat& q, float x ) { q.v.x = x; } )
		.element( +[]( const b3Quat& q ) { return q.v.y; }, +[]( b3Quat& q, float y ) { q.v.y = y; } )
		.element( +[]( const b3Quat& q ) { return q.v.z; }, +[]( b3Quat& q, float z ) { q.v.z = z; } )
		.element( +[]( const b3Quat& q ) { return q.s; }, +[]( b3Quat& q, float s ) { q.s = s; } );

	// b3AABB { lowerBound, upperBound } -> mathcat Box3 [minX,minY,minZ,maxX,maxY,maxZ].
	value_array<b3AABB>( "b3AABB" )
		.element( +[]( const b3AABB& a ) { return a.lowerBound.x; }, +[]( b3AABB& a, float v ) { a.lowerBound.x = v; } )
		.element( +[]( const b3AABB& a ) { return a.lowerBound.y; }, +[]( b3AABB& a, float v ) { a.lowerBound.y = v; } )
		.element( +[]( const b3AABB& a ) { return a.lowerBound.z; }, +[]( b3AABB& a, float v ) { a.lowerBound.z = v; } )
		.element( +[]( const b3AABB& a ) { return a.upperBound.x; }, +[]( b3AABB& a, float v ) { a.upperBound.x = v; } )
		.element( +[]( const b3AABB& a ) { return a.upperBound.y; }, +[]( b3AABB& a, float v ) { a.upperBound.y = v; } )
		.element( +[]( const b3AABB& a ) { return a.upperBound.z; }, +[]( b3AABB& a, float v ) { a.upperBound.z = v; } );

	// b3Transform stays an object of two arrays: { position: Vec3, quaternion: Quat }.
	value_object<b3Transform>( "b3Transform" )
		.field( "position", &b3Transform::p )
		.field( "quaternion", &b3Transform::q );

	value_object<b3Plane>( "b3Plane" )
		.field( "normal", &b3Plane::normal )
		.field( "offset", &b3Plane::offset );

	// Static scratch the facade points the out-param `*Into` readers at (§2).
	function( "b3_getMathScratch", +[]() -> uintptr_t { return reinterpret_cast<uintptr_t>( g_mathScratch ); } );

	// Binding-site out-param metadata. Read at build time by scripts/build.mjs (to
	// codegen the public facade readers + emit the .d.ts). Returns a plain JS value
	// (val), built the same way as the query-buffer returns above — no hand-rolled
	// JSON. Shape: [{method, sizes:[N], trailing:N, tsTypes:["b3Vec3",...]}].
	function( "_outMeta", +[]() -> val {
		val arr = val::array();
		for ( const auto& e : g_outRegistry )
		{
			val o = val::object();
			o.set( "method", val( e.method ) );
			val sizes = val::array();
			for ( int s : e.sizes ) sizes.call<void>( "push", s );
			o.set( "sizes", sizes );
			o.set( "trailing", e.trailing );
			val tsTypes = val::array();
			for ( const auto& t : e.tsTypes ) tsTypes.call<void>( "push", val( t ) );
			o.set( "tsTypes", tsTypes );
			arr.call<void>( "push", o );
		}
		return arr;
	} );

	// Return-type overrides for val-returning functions (emit-tsd sees them as `any`).
	// Read at build time by scripts/build.mjs. Shape: [{method, tsType}].
	function( "_retMeta", +[]() -> val {
		val arr = val::array();
		for ( const auto& e : g_retRegistry )
		{
			val o = val::object();
			o.set( "method", val( e.method ) );
			o.set( "tsType", val( e.tsType ) );
			arr.call<void>( "push", o );
		}
		return arr;
	} );

	// Packed-record tier strides (see namespace layout). Read at build time by
	// scripts/build.mjs to codegen the facade. One flat {name: stride} object.
	function( "_layoutMeta", +[]() -> val {
		val o = val::object();
		o.set( "contact", layout::contact );
		o.set( "manifoldF32", layout::manifoldF32 );
		o.set( "manifoldI32", layout::manifoldI32 );
		o.set( "pointF32", layout::pointF32 );
		o.set( "pointI32", layout::pointI32 );
		o.set( "contactTouch", layout::contactTouch );
		o.set( "contactHitI32", layout::contactHitI32 );
		o.set( "contactHitF64", layout::contactHitF64 );
		o.set( "bodyMoveI32", layout::bodyMoveI32 );
		o.set( "bodyMoveF64", layout::bodyMoveF64 );
		o.set( "sensorTouch", layout::sensorTouch );
		o.set( "joint", layout::joint );
		o.set( "plane", layout::plane );
		o.set( "shapeId", layout::shapeId );
		o.set( "debugShapeI32", layout::debugShapeI32 );
		o.set( "debugShapeF64", layout::debugShapeF64 );
		o.set( "debugSegmentF64", layout::debugSegmentF64 );
		o.set( "debugSegmentI32", layout::debugSegmentI32 );
		o.set( "debugPointF64", layout::debugPointF64 );
		o.set( "debugPointF32", layout::debugPointF32 );
		o.set( "debugPointI32", layout::debugPointI32 );
		o.set( "debugSphereF64", layout::debugSphereF64 );
		o.set( "debugSphereF32", layout::debugSphereF32 );
		o.set( "debugSphereI32", layout::debugSphereI32 );
		o.set( "debugCapsuleF64", layout::debugCapsuleF64 );
		o.set( "debugCapsuleF32", layout::debugCapsuleF32 );
		o.set( "debugCapsuleI32", layout::debugCapsuleI32 );
		o.set( "debugBoxF32", layout::debugBoxF32 );
		o.set( "debugBoxF64", layout::debugBoxF64 );
		o.set( "debugBoxI32", layout::debugBoxI32 );
		o.set( "debugBoundsF64", layout::debugBoundsF64 );
		o.set( "debugBoundsI32", layout::debugBoundsI32 );
		o.set( "debugTransformF64", layout::debugTransformF64 );
		o.set( "debugTransformI32", layout::debugTransformI32 );
		return o;
	} );

	value_object<b3WorldId>( "b3WorldId" )
		.field( "index1", &b3WorldId::index1 )
		.field( "generation", &b3WorldId::generation );

	value_object<b3BodyId>( "b3BodyId" )
		.field( "index1", &b3BodyId::index1 )
		.field( "world0", &b3BodyId::world0 )
		.field( "generation", &b3BodyId::generation );

	value_object<b3ShapeId>( "b3ShapeId" )
		.field( "index1", &b3ShapeId::index1 )
		.field( "world0", &b3ShapeId::world0 )
		.field( "generation", &b3ShapeId::generation );

	value_object<b3JointId>( "b3JointId" )
		.field( "index1", &b3JointId::index1 )
		.field( "world0", &b3JointId::world0 )
		.field( "generation", &b3JointId::generation );

	value_object<b3ContactId>( "b3ContactId" )
		.field( "index1", &b3ContactId::index1 )
		.field( "world0", &b3ContactId::world0 )
		.field( "padding", &b3ContactId::padding )
		.field( "generation", &b3ContactId::generation );

	value_object<b3Sphere>( "b3Sphere" )
		.field( "center", &b3Sphere::center )
		.field( "radius", &b3Sphere::radius );

	value_object<b3Capsule>( "b3Capsule" )
		.field( "center1", &b3Capsule::center1 )
		.field( "center2", &b3Capsule::center2 )
		.field( "radius", &b3Capsule::radius );

	value_object<b3MotionLocks>( "b3MotionLocks" )
		.field( "linearX", &b3MotionLocks::linearX )
		.field( "linearY", &b3MotionLocks::linearY )
		.field( "linearZ", &b3MotionLocks::linearZ )
		.field( "angularX", &b3MotionLocks::angularX )
		.field( "angularY", &b3MotionLocks::angularY )
		.field( "angularZ", &b3MotionLocks::angularZ );

	value_object<b3Filter>( "b3Filter" )
		.field( "categoryBits", &b3Filter::categoryBits )
		.field( "maskBits", &b3Filter::maskBits )
		.field( "groupIndex", &b3Filter::groupIndex );

	value_object<b3SurfaceMaterial>( "b3SurfaceMaterial" )
		.field( "friction", &b3SurfaceMaterial::friction )
		.field( "restitution", &b3SurfaceMaterial::restitution )
		.field( "rollingResistance", &b3SurfaceMaterial::rollingResistance )
		.field( "tangentVelocity", &b3SurfaceMaterial::tangentVelocity )
		.field( "userMaterialId", &b3SurfaceMaterial::userMaterialId )
		.field( "customColor", &b3SurfaceMaterial::customColor );

	value_object<b3Capacity>( "b3Capacity" )
		.field( "staticShapeCount", &b3Capacity::staticShapeCount )
		.field( "dynamicShapeCount", &b3Capacity::dynamicShapeCount )
		.field( "staticBodyCount", &b3Capacity::staticBodyCount )
		.field( "dynamicBodyCount", &b3Capacity::dynamicBodyCount )
		.field( "contactCount", &b3Capacity::contactCount );

	// Pointer/callback/userData fields are not registered — they round-trip to null (the correct default).
	// internalValue IS registered so b3Default*Def() validation magic survives the JS round-trip.
	value_object<b3WorldDef>( "b3WorldDef" )
		.field( "gravity", &b3WorldDef::gravity )
		.field( "restitutionThreshold", &b3WorldDef::restitutionThreshold )
		.field( "hitEventThreshold", &b3WorldDef::hitEventThreshold )
		.field( "contactHertz", &b3WorldDef::contactHertz )
		.field( "contactDampingRatio", &b3WorldDef::contactDampingRatio )
		.field( "contactSpeed", &b3WorldDef::contactSpeed )
		.field( "maximumLinearSpeed", &b3WorldDef::maximumLinearSpeed )
		.field( "enableSleep", &b3WorldDef::enableSleep )
		.field( "enableContinuous", &b3WorldDef::enableContinuous )
		.field( "workerCount", &b3WorldDef::workerCount )
		.field( "restitutionIterations", &b3WorldDef::restitutionIterations )
		.field( "enableRestitutionPropagation", &b3WorldDef::enableRestitutionPropagation )
		.field( "isotropicInertiaTolerance", &b3WorldDef::isotropicInertiaTolerance )
		.field( "capacity", &b3WorldDef::capacity )
		.field( "internalValue", &b3WorldDef::internalValue );

	value_object<b3BodyDef>( "b3BodyDef" )
		.field( "type", &b3BodyDef::type )
		.field( "position", &b3BodyDef::position )
		.field( "rotation", &b3BodyDef::rotation )
		.field( "linearVelocity", &b3BodyDef::linearVelocity )
		.field( "angularVelocity", &b3BodyDef::angularVelocity )
		.field( "linearDamping", &b3BodyDef::linearDamping )
		.field( "angularDamping", &b3BodyDef::angularDamping )
		.field( "gravityScale", &b3BodyDef::gravityScale )
		.field( "sleepThreshold", &b3BodyDef::sleepThreshold )
		.field( "motionLocks", &b3BodyDef::motionLocks )
		.field( "enableSleep", &b3BodyDef::enableSleep )
		.field( "isAwake", &b3BodyDef::isAwake )
		.field( "isBullet", &b3BodyDef::isBullet )
		.field( "isEnabled", &b3BodyDef::isEnabled )
		.field( "allowFastRotation", &b3BodyDef::allowFastRotation )
		.field( "enableContactRecycling", &b3BodyDef::enableContactRecycling )
		.field( "safetyFactor", &b3BodyDef::safetyFactor )
		.field( "internalValue", &b3BodyDef::internalValue );

	value_object<b3ShapeDef>( "b3ShapeDef" )
		.field( "baseMaterial", &b3ShapeDef::baseMaterial )
		.field( "density", &b3ShapeDef::density )
		.field( "explosionScale", &b3ShapeDef::explosionScale )
		.field( "filter", &b3ShapeDef::filter )
		.field( "enableCustomFiltering", &b3ShapeDef::enableCustomFiltering )
		.field( "isSensor", &b3ShapeDef::isSensor )
		.field( "enableSensorEvents", &b3ShapeDef::enableSensorEvents )
		.field( "enableContactEvents", &b3ShapeDef::enableContactEvents )
		.field( "enableHitEvents", &b3ShapeDef::enableHitEvents )
		.field( "enablePreSolveEvents", &b3ShapeDef::enablePreSolveEvents )
		.field( "invokeContactCreation", &b3ShapeDef::invokeContactCreation )
		.field( "updateBodyMass", &b3ShapeDef::updateBodyMass )
		.field( "enableSpeculativeContact", &b3ShapeDef::enableSpeculativeContact )
		.field( "internalValue", &b3ShapeDef::internalValue );

	function( "b3DefaultWorldDef()", &b3DefaultWorldDef );
	function( "b3DefaultBodyDef()", &b3DefaultBodyDef );
	function( "b3DefaultShapeDef()", &b3DefaultShapeDef );
	function( "b3DefaultFilter()", &b3DefaultFilter );
	function( "b3DefaultSurfaceMaterial()", &b3DefaultSurfaceMaterial );

	function( "b3CreateWorld(worldDef)", +[]( b3WorldDef def ) {
		// Exact shape outlines. shape.c calls destroyDebugShape with no NULL check
		// once a user shape exists, so both callbacks are always installed.
		// b3DestroyWorld releases leftovers through b3DestroyShapeAllocations.
		def.createDebugShape = createDebugShapeCallback;
		def.destroyDebugShape = destroyDebugShapeCallback;
		def.userDebugShapeContext = nullptr;
		return b3CreateWorld( &def );
	} );
	function( "b3DestroyWorld(worldId)", +[]( b3WorldId worldId ) {
		if ( b3World_IsValid( worldId ) ) g_constantForces[worldId.index1 - 1].clear();
		b3DestroyWorld( worldId );
	} );
	function( "b3World_IsValid(worldId)", &b3World_IsValid );
	// Re-applies the constant forces (b3Body_SetConstantForce/Torque) before stepping.
	function( "b3World_Step(worldId, timeStep, subStepCount)", +[]( b3WorldId worldId, float timeStep, int subStepCount ) {
		if ( b3World_IsValid( worldId ) ) applyConstantForces( worldId );
		b3World_Step( worldId, timeStep, subStepCount );
	} );
	// Install native friction/restitution mixing callbacks (b3MixingRule values).
	function( "b3World_SetMixingRules(worldId, frictionRule, restitutionRule)", &setMixingRules );
	function( "b3World_SetGravity(worldId, gravity)", &b3World_SetGravity );
	out_function( "b3World_GetGravity(out, worldId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3WorldId worldId ) { writeVec3( out, b3World_GetGravity( worldId ) ); } );

	function( "b3GetWorldCount()", &b3GetWorldCount );
	function( "b3GetMaxWorldCount()", &b3GetMaxWorldCount );
	out_function( "b3World_GetBounds(out, worldId)", out_desc::AABB, out_desc::Pass, +[]( uintptr_t out, b3WorldId worldId ) { writeAABB( out, b3World_GetBounds( worldId ) ); } );
	function( "b3World_EnableSleeping(worldId, flag)", &b3World_EnableSleeping );
	function( "b3World_IsSleepingEnabled(worldId)", &b3World_IsSleepingEnabled );
	function( "b3World_EnableContinuous(worldId, flag)", &b3World_EnableContinuous );
	function( "b3World_IsContinuousEnabled(worldId)", &b3World_IsContinuousEnabled );
	function( "b3World_SetRestitutionThreshold(worldId, value)", &b3World_SetRestitutionThreshold );
	function( "b3World_GetRestitutionThreshold(worldId)", &b3World_GetRestitutionThreshold );
	function( "b3World_SetHitEventThreshold(worldId, value)", &b3World_SetHitEventThreshold );
	function( "b3World_GetHitEventThreshold(worldId)", &b3World_GetHitEventThreshold );
	function( "b3World_SetContactTuning(worldId, hertz, dampingRatio, contactSpeed)", &b3World_SetContactTuning );
	function( "b3World_SetContactRecycleDistance(worldId, recycleDistance)", &b3World_SetContactRecycleDistance );
	function( "b3World_GetContactRecycleDistance(worldId)", &b3World_GetContactRecycleDistance );
	function( "b3World_SetMaximumLinearSpeed(worldId, maximumLinearSpeed)", &b3World_SetMaximumLinearSpeed );
	function( "b3World_GetMaximumLinearSpeed(worldId)", &b3World_GetMaximumLinearSpeed );
	function( "b3World_EnableWarmStarting(worldId, flag)", &b3World_EnableWarmStarting );
	function( "b3World_IsWarmStartingEnabled(worldId)", &b3World_IsWarmStartingEnabled );
	function( "b3World_GetAwakeBodyCount(worldId)", &b3World_GetAwakeBodyCount );
	function( "b3World_SetWorkerCount(worldId, count)", &b3World_SetWorkerCount );
	function( "b3World_GetWorkerCount(worldId)", &b3World_GetWorkerCount );
	function( "b3World_EnableSpeculative(worldId, flag)", &b3World_EnableSpeculative );
	function( "b3World_GetMaxCapacity(worldId)", &b3World_GetMaxCapacity );

	function( "b3CreateBody(worldId, bodyDef)", +[]( b3WorldId worldId, b3BodyDef def ) { return b3CreateBody( worldId, &def ); } );
	function( "b3DestroyBody(bodyId)", +[]( b3BodyId bodyId ) {
		clearConstantForces( bodyId );
		b3DestroyBody( bodyId );
	} );
	function( "b3Body_IsValid(id)", &b3Body_IsValid );
	function( "b3Body_GetType(bodyId)", &b3Body_GetType );
	out_function( "b3Body_GetPosition(out, bodyId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId id ) { writeVec3( out, b3Body_GetPosition( id ) ); } );
	out_function( "b3Body_GetRotation(out, bodyId)", out_desc::Quat, out_desc::Pass, +[]( uintptr_t out, b3BodyId id ) { writeQuat( out, b3Body_GetRotation( id ) ); } );
	// Transform reads as two out params — position (Vec3) then rotation (Quat).
	out_function( "b3Body_GetTransform(outPosition, outRotation, bodyId)", out_desc::Vec3, out_desc::Quat, out_desc::Pass,
		+[]( uintptr_t outPos, uintptr_t outRot, b3BodyId id ) { b3Transform t = b3Body_GetTransform( id ); writeVec3( outPos, t.p ); writeQuat( outRot, t.q ); } );
	// One call for many bodies: ids is an Int32Array of (index1, world0, generation)
	// triples; returns a copied Float64Array, 7 per body (px py pz qx qy qz qw), NaN
	// for an invalid id.
	ret_function( "b3Body_GetTransformsPacked(ids): Float64Array", &getBodyTransformsPacked );
	function( "b3Body_SetTransform(bodyId, position, rotation)", &b3Body_SetTransform );
	out_function( "b3Body_GetLinearVelocity(out, bodyId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId id ) { writeVec3( out, b3Body_GetLinearVelocity( id ) ); } );
	out_function( "b3Body_GetAngularVelocity(out, bodyId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId id ) { writeVec3( out, b3Body_GetAngularVelocity( id ) ); } );

	function( "b3CreateSphereShape(bodyId, shapeDef, sphere)",
		+[]( b3BodyId bodyId, b3ShapeDef def, b3Sphere sphere ) { return b3CreateSphereShape( bodyId, &def, &sphere ); } );
	function( "b3CreateCapsuleShape(bodyId, shapeDef, capsule)",
		+[]( b3BodyId bodyId, b3ShapeDef def, b3Capsule capsule ) { return b3CreateCapsuleShape( bodyId, &def, &capsule ); } );
	function( "b3Shape_IsValid(id)", &b3Shape_IsValid );

	// Binding-side helper: build a box hull in C++ memory and create a hull
	// shape from it. b3BoxHull embeds a b3HullData with internal offsets that
	// cannot survive a JS value_object copy, so this must stay on the C++ side.
	function( "b3CreateBoxShape(bodyId, shapeDef, hx, hy, hz)",
		+[]( b3BodyId bodyId, b3ShapeDef def, float hx, float hy, float hz )
		{
			b3BoxHull hull = b3MakeBoxHull( hx, hy, hz );
			return b3CreateHullShape( bodyId, &def, &hull.base );
		} );

	class_<b3HullData>( "b3HullData" );
	function( "b3CreateHull(points)", +[]( val points ) -> b3HullData*
	{
		std::vector<float> f = convertJSArrayToNumberVector<float>( points );
		int count = (int)( f.size() / 3 );
		return b3CreateHull( reinterpret_cast<const b3Vec3*>( f.data() ), count, count );
	}, allow_raw_pointers() );
	function( "b3CreateCylinder(height, radius, yOffset, sides)", &b3CreateCylinder, allow_raw_pointers() );
	function( "b3CreateCone(height, radius1, radius2, slices)", &b3CreateCone, allow_raw_pointers() );
	function( "b3CreateRock(radius)", &b3CreateRock, allow_raw_pointers() );
	function( "b3CloneAndTransformHull(original, transform, scale)", &b3CloneAndTransformHull, allow_raw_pointers() );
	function( "b3DestroyHull(hull)", &b3DestroyHull, allow_raw_pointers() );
	function( "b3CreateHullShape(bodyId, shapeDef, hull)",
		+[]( b3BodyId bodyId, b3ShapeDef def, b3HullData* hull ) { return b3CreateHullShape( bodyId, &def, hull ); },
		allow_raw_pointers() );
	ret_function( "b3GetHullVertices(hull): Float32Array", +[]( const b3HullData* hull ) -> val
	{
		if ( hull == nullptr ) return val::global( "Float32Array" ).new_( 0 );
		return val( typed_memory_view( (size_t)hull->vertexCount * 3, reinterpret_cast<const float*>( b3GetHullPoints( hull ) ) ) );
	}, allow_raw_pointers() );

	class_<b3MeshData>( "b3MeshData" );
	function( "b3CreateMesh(positions, indices)", +[]( val positions, val indices ) -> b3MeshData*
	{
		std::vector<float> vf = convertJSArrayToNumberVector<float>( positions );
		std::vector<int32_t> vi = convertJSArrayToNumberVector<int32_t>( indices );
		b3MeshDef def = {};
		def.vertices = reinterpret_cast<b3Vec3*>( vf.data() );
		def.vertexCount = (int)( vf.size() / 3 );
		def.indices = vi.data();
		def.triangleCount = (int)( vi.size() / 3 );
		def.weldVertices = true;
		return b3CreateMesh( &def, nullptr, 0 );
	}, allow_raw_pointers() );
	function( "b3DestroyMesh(mesh)", &b3DestroyMesh, allow_raw_pointers() );
	function( "b3CreateMeshShape(bodyId, shapeDef, mesh, scale)",
		+[]( b3BodyId bodyId, b3ShapeDef def, b3MeshData* mesh, b3Vec3 scale ) { return b3CreateMeshShape( bodyId, &def, mesh, scale ); },
		allow_raw_pointers() );

	function( "b3CreateGridMesh(xCount, zCount, cellWidth, materialCount, identifyEdges)", +[]( int xCount, int zCount, float cellWidth, int materialCount, bool identifyEdges )
		{ return b3CreateGridMesh( xCount, zCount, cellWidth, materialCount, identifyEdges ); }, allow_raw_pointers() );
	function( "b3CreateWaveMesh(xCount, zCount, cellWidth, amplitude, rowFrequency, columnFrequency)", +[]( int xCount, int zCount, float cellWidth, float amplitude, float rowFrequency, float columnFrequency )
		{ return b3CreateWaveMesh( xCount, zCount, cellWidth, amplitude, rowFrequency, columnFrequency ); }, allow_raw_pointers() );
	function( "b3CreateTorusMesh(radialResolution, tubularResolution, radius, thickness)", +[]( int radialResolution, int tubularResolution, float radius, float thickness )
		{ return b3CreateTorusMesh( radialResolution, tubularResolution, radius, thickness ); }, allow_raw_pointers() );
	function( "b3CreateBoxMesh(center, extent, identifyEdges)", +[]( b3Vec3 center, b3Vec3 extent, bool identifyEdges )
		{ return b3CreateBoxMesh( center, extent, identifyEdges ); }, allow_raw_pointers() );
	function( "b3CreateHollowBoxMesh(center, extent)", +[]( b3Vec3 center, b3Vec3 extent )
		{ return b3CreateHollowBoxMesh( center, extent ); }, allow_raw_pointers() );
	function( "b3CreatePlatformMesh(center, height, topWidth, bottomWidth)", +[]( b3Vec3 center, float height, float topWidth, float bottomWidth )
		{ return b3CreatePlatformMesh( center, height, topWidth, bottomWidth ); }, allow_raw_pointers() );

	ret_function( "b3GetMeshVertices(mesh): Float32Array", +[]( b3MeshData* mesh ) -> val
	{
		const b3Vec3* v = b3GetMeshVertices( mesh );
		int n = mesh->vertexCount;
		val view = val( typed_memory_view( (size_t)( n * 3 ), reinterpret_cast<const float*>( v ) ) );
		return view.call<val>( "slice" );
	}, allow_raw_pointers() );
	ret_function( "b3GetMeshIndices(mesh): Uint32Array", +[]( b3MeshData* mesh ) -> val
	{
		const b3MeshTriangle* t = b3GetMeshTriangles( mesh );
		int n = mesh->triangleCount;
		val view = val( typed_memory_view( (size_t)( n * 3 ), reinterpret_cast<const int32_t*>( t ) ) );
		return val::global( "Uint32Array" ).new_( view );
	}, allow_raw_pointers() );
	// per-triangle material indices as Uint8Array (empty if the mesh has none)
	ret_function( "b3GetMeshMaterialIndices(mesh): Uint8Array", +[]( b3MeshData* mesh ) -> val
	{
		const uint8_t* mi = b3GetMeshMaterialIndices( mesh );
		int n = mesh->triangleCount;
		if ( mi == nullptr ) return val::global( "Uint8Array" ).new_( 0 );
		val view = val( typed_memory_view( (size_t)n, mi ) );
		return view.call<val>( "slice" );
	}, allow_raw_pointers() );

	class_<b3CompoundData>( "b3CompoundData" );
	function( "b3CreateCompound(spec)", +[]( val spec ) -> b3CompoundData*
	{
		const b3SurfaceMaterial defMat = b3DefaultSurfaceMaterial();
		auto mat = [&]( val child ) -> b3SurfaceMaterial
		{
			val m = child["material"];
			return m.isUndefined() ? defMat : m.as<b3SurfaceMaterial>();
		};
		auto arrOf = [&]( const char* key ) -> val
		{
			val a = spec[key];
			return a.isUndefined() ? val::array() : a;
		};

		std::vector<b3CompoundSphereDef> spheres;
		val s = arrOf( "spheres" );
		for ( unsigned i = 0, n = s["length"].as<unsigned>(); i < n; ++i ) { val c = s[i]; spheres.push_back( { c["sphere"].as<b3Sphere>(), mat( c ) } ); }

		std::vector<b3CompoundCapsuleDef> capsules;
		val cap = arrOf( "capsules" );
		for ( unsigned i = 0, n = cap["length"].as<unsigned>(); i < n; ++i ) { val c = cap[i]; capsules.push_back( { c["capsule"].as<b3Capsule>(), mat( c ) } ); }

		std::vector<b3CompoundHullDef> hulls;
		val h = arrOf( "hulls" );
		for ( unsigned i = 0, n = h["length"].as<unsigned>(); i < n; ++i ) { val c = h[i]; hulls.push_back( { c["hull"].as<b3HullData*>( allow_raw_pointers() ), c["transform"].as<b3Transform>(), mat( c ) } ); }

		b3CompoundDef def = {};
		def.spheres = spheres.data();
		def.sphereCount = (int)spheres.size();
		def.capsules = capsules.data();
		def.capsuleCount = (int)capsules.size();
		def.hulls = hulls.data();
		def.hullCount = (int)hulls.size();
		return b3CreateCompound( &def );
	}, allow_raw_pointers() );
	function( "b3DestroyCompound(compound)", &b3DestroyCompound, allow_raw_pointers() );
	function( "b3CreateBakedCompoundShape(bodyId, shapeDef, compound)",
		+[]( b3BodyId bodyId, b3ShapeDef def, b3CompoundData* compound ) { return b3CreateBakedCompoundShape( bodyId, &def, compound ); },
		allow_raw_pointers() );

	// Convex decomposition (V-HACD). Each shape-creating call runs the whole
	// mesh -> hulls -> b3CreateHullShape pipeline in C++ and returns the shape ids
	// packed (ShapeIdBuffer layout + skipped count), so a decomposition costs one
	// boundary crossing however many pieces it has. The facade wraps these four so
	// trailing options/material/maxVerticesPerHull arguments may be omitted.
	ret_function( "b3ComputeConvexDecomposition(positions, indices, options): b3ConvexDecomposition",
		+[]( val positions, val indices, val options ) -> val
		{
			DecompositionMesh mesh = readDecompositionMesh( positions, indices );
			return toPacked( runDecomposition( mesh, readDecompositionOptions( options ) ) );
		} );
	ret_function( "b3CreateConvexDecompositionShapes(bodyId, shapeDef, positions, indices, options): b3DecompositionShapes",
		+[]( b3BodyId bodyId, b3ShapeDef def, val positions, val indices, val options ) -> val
		{
			if ( !b3Body_IsValid( bodyId ) ) throwJsError( e_bodyInvalid );
			DecompositionMesh mesh = readDecompositionMesh( positions, indices );
			DecompositionOptions opts = readDecompositionOptions( options );
			return attachHullShapes( bodyId, def, runDecomposition( mesh, opts ), opts.maxVerticesPerHull );
		} );
	ret_function( "b3CreateConvexDecompositionShapesFromPacked(bodyId, shapeDef, packed, maxVerticesPerHull): b3DecompositionShapes",
		+[]( b3BodyId bodyId, b3ShapeDef def, val packed, val maxVerticesPerHull ) -> val
		{
			return attachHullShapes( bodyId, def, readPacked( packed ), readMaxVertices( maxVerticesPerHull ) );
		} );
	// The compound copies the hulls, so they are freed here. The compound itself is
	// referenced (not copied) by b3CreateBakedCompoundShape: keep it alive until the shape
	// is destroyed, then b3DestroyCompound it. Compounds require a static body.
	ret_function( "b3CreateDecompositionCompound(packed, material): b3DecompositionCompound",
		+[]( val packed, val material ) -> val
		{
			DecompositionPieces pieces = readPacked( packed );
			const b3SurfaceMaterial mat = ( material.isUndefined() || material.isNull() )
				? b3DefaultSurfaceMaterial() : material.as<b3SurfaceMaterial>();
			std::vector<b3HullData*> hulls;
			std::vector<b3CompoundHullDef> defs;
			int skipped = 0;
			for ( size_t i = 0; i + 1 < pieces.offsets.size(); ++i )
			{
				const uint32_t begin = pieces.offsets[i];
				b3HullData* hull = buildHullWithRetry( pieces.points.data() + (size_t)begin * 3,
					(int)( pieces.offsets[i + 1] - begin ), 32 );
				if ( hull == nullptr )
				{
					++skipped;
					continue;
				}
				hulls.push_back( hull );
				defs.push_back( { hull, b3Transform_identity, mat } );
			}
			b3CompoundData* compound = nullptr;
			if ( !defs.empty() )
			{
				b3CompoundDef def = {};
				def.hulls = defs.data();
				def.hullCount = (int)defs.size();
				compound = b3CreateCompound( &def );
			}
			for ( b3HullData* hull : hulls ) b3DestroyHull( hull );
			val out = val::object();
			out.set( "compound", compound ? val( compound, allow_raw_pointers() ) : val::null() );
			out.set( "skipped", skipped );
			return out;
		} );
	function( "b3HasThreads()", +[]() -> bool
	{
#ifdef __EMSCRIPTEN_PTHREADS__
		return true;
#else
		return false;
#endif
	} );
#ifdef __EMSCRIPTEN_PTHREADS__
	// Internal: driven by the facade's b3Create*/b3Compute*Async Promise wrappers.
	class_<ConvexDecompositionJob>( "ConvexDecompositionJobImpl" )
		.constructor<>()
		.function( "start", &ConvexDecompositionJob::start )
		.function( "isReady", &ConvexDecompositionJob::isReady )
		.function( "takeResult", &ConvexDecompositionJob::takeResult );
#endif

	class_<b3HeightFieldData>( "b3HeightFieldData" );
	function( "b3CreateHeightField(heights, countX, countZ, scale)", +[]( val heights, int countX, int countZ, b3Vec3 scale ) -> b3HeightFieldData*
	{
		std::vector<float> h = convertJSArrayToNumberVector<float>( heights );
		float mn = h.empty() ? 0.0f : h[0], mx = mn;
		for ( float v : h ) { mn = v < mn ? v : mn; mx = v > mx ? v : mx; }
		b3HeightFieldDef def = {};
		def.heights = h.data();
		def.scale = scale;
		def.countX = countX;
		def.countZ = countZ;
		def.globalMinimumHeight = mn;
		def.globalMaximumHeight = mx;
		return b3CreateHeightField( &def );
	}, allow_raw_pointers() );
	function( "b3DestroyHeightField(heightField)", &b3DestroyHeightField, allow_raw_pointers() );
	function( "b3CreateHeightFieldShape(bodyId, shapeDef, heightField)",
		+[]( b3BodyId bodyId, b3ShapeDef def, b3HeightFieldData* hf ) { return b3CreateHeightFieldShape( bodyId, &def, hf ); },
		allow_raw_pointers() );
	function( "b3CreateGrid(rowCount, columnCount, scale, makeHoles)", +[]( int rowCount, int columnCount, b3Vec3 scale, bool makeHoles )
		{ return b3CreateGrid( rowCount, columnCount, scale, makeHoles ); }, allow_raw_pointers() );
	function( "b3CreateWave(rowCount, columnCount, scale, rowFrequency, columnFrequency, makeHoles)", +[]( int rowCount, int columnCount, b3Vec3 scale, float rowFrequency, float columnFrequency, bool makeHoles )
		{ return b3CreateWave( rowCount, columnCount, scale, rowFrequency, columnFrequency, makeHoles ); }, allow_raw_pointers() );
	function( "b3CreateTransformedHullShape(bodyId, shapeDef, hull, transform, scale)", +[]( b3BodyId bodyId, b3ShapeDef def, b3HullData* hull, b3Transform transform, b3Vec3 scale )
		{ return b3CreateTransformedHullShape( bodyId, &def, hull, transform, scale ); }, allow_raw_pointers() );

	value_object<b3PlaneResult>( "b3PlaneResult" )
		.field( "plane", &b3PlaneResult::plane )
		.field( "point", &b3PlaneResult::point )
		.field( "triangleIndex", &b3PlaneResult::triangleIndex )
		.field( "childIndex", &b3PlaneResult::childIndex )
		.field( "materialIndex", &b3PlaneResult::materialIndex );
	function( "b3World_CastMover(worldId, origin, mover, translation, filter, callback)",
		+[]( b3WorldId worldId, b3Vec3 origin, b3Capsule mover, b3Vec3 translation, b3QueryFilter filter, val cb ) -> float
		{
			return b3World_CastMover( worldId, origin, &mover, translation, filter,
				[]( b3ShapeId shapeId, void* ctx ) -> bool
				{ val r = ( *static_cast<val*>( ctx ) )( shapeId ); return r.isUndefined() ? true : r.as<bool>(); },
				&cb );
		} );
	// Natively filtered variants: b3QueryOptions skips ignored bodies/shapes and sensors inside the
	// query, with no JS callback per candidate.
	ret_function( "b3World_CollideMoverPacked(worldId, origin, mover, filter, options): Float64Array", &collideMoverPacked );
	function( "b3World_CastMoverFiltered(worldId, origin, mover, translation, filter, options)", &castMoverFiltered );
	ret_function( "b3World_CastRayClosestFiltered(worldId, origin, translation, filter, options): Float64Array",
		&castRayClosestFiltered );
	ret_function( "b3World_CastShapeClosestFiltered(worldId, origin, points, radius, translation, filter, options): Float64Array",
		&castShapeClosestFiltered );
	function( "b3World_CollideMover(worldId, origin, mover, filter, callback)", +[]( b3WorldId worldId, b3Vec3 origin, b3Capsule mover, b3QueryFilter filter, val cb )
	{
		b3World_CollideMover( worldId, origin, &mover, filter,
			[]( b3ShapeId shapeId, const b3PlaneResult* planes, int planeCount, void* ctx ) -> bool
			{
				// Pack the planes into one flat Float32Array (layout::plane floats each:
				// plane.normal(3), plane.offset, point(3)) rather than a JS array of
				// objects — one copy, no per-plane boundary crossing. Read on the JS
				// side with createPlaneResult / getPlaneResultAt.
				static thread_local std::vector<float> packed;
				packed.clear();
				packed.reserve( (size_t)planeCount * layout::plane );
				for ( int i = 0; i < planeCount; ++i )
				{
					const b3PlaneResult& pr = planes[i];
					packed.insert( packed.end(), {
						pr.plane.normal.x, pr.plane.normal.y, pr.plane.normal.z, pr.plane.offset,
						pr.point.x, pr.point.y, pr.point.z } );
				}
				val buf = val::object();
				buf.set( "count", planeCount );
				buf.set( "data", toF32( packed ) );
				val r = ( *static_cast<val*>( ctx ) )( shapeId, buf );
				return r.isUndefined() ? true : r.as<bool>();
			},
			&cb );
	} );

	value_object<b3CollisionPlane>( "b3CollisionPlane" )
		.field( "plane", &b3CollisionPlane::plane )
		.field( "pushLimit", &b3CollisionPlane::pushLimit )
		.field( "push", &b3CollisionPlane::push )
		.field( "clipVelocity", &b3CollisionPlane::clipVelocity );
	value_object<b3PlaneSolverResult>( "b3PlaneSolverResult" )
		.field( "delta", &b3PlaneSolverResult::delta )
		.field( "iterationCount", &b3PlaneSolverResult::iterationCount );

	function( "b3SolvePlanes(targetDelta, planes)", +[]( b3Vec3 targetDelta, val jsPlanes ) -> b3PlaneSolverResult
	{
		int n = jsPlanes["length"].as<int>();
		std::vector<b3CollisionPlane> planes;
		planes.reserve( n );
		for ( int i = 0; i < n; ++i ) planes.push_back( jsPlanes[i].as<b3CollisionPlane>() );
		return b3SolvePlanes( targetDelta, planes.data(), n );
	} );

	function( "b3ClipVector(vector, planes)", +[]( b3Vec3 vector, val jsPlanes ) -> b3Vec3
	{
		int n = jsPlanes["length"].as<int>();
		std::vector<b3CollisionPlane> planes;
		planes.reserve( n );
		for ( int i = 0; i < n; ++i ) planes.push_back( jsPlanes[i].as<b3CollisionPlane>() );
		return b3ClipVector( vector, planes.data(), n );
	} );

	// colorCounts/manifoldCounts fixed-array fields are omitted; scalar counts only.
	value_object<b3Counters>( "b3Counters" )
		.field( "bodyCount", &b3Counters::bodyCount )
		.field( "shapeCount", &b3Counters::shapeCount )
		.field( "contactCount", &b3Counters::contactCount )
		.field( "jointCount", &b3Counters::jointCount )
		.field( "islandCount", &b3Counters::islandCount )
		.field( "stackUsed", &b3Counters::stackUsed )
		.field( "byteCount", &b3Counters::byteCount )
		.field( "taskCount", &b3Counters::taskCount )
		.field( "awakeContactCount", &b3Counters::awakeContactCount )
		.field( "treeHeight", &b3Counters::treeHeight )
		.field( "staticTreeHeight", &b3Counters::staticTreeHeight );
	function( "b3World_GetCounters(worldId)", &b3World_GetCounters );

	// Persistent callbacks: the JS function is heap-held for the world's lifetime (one small leak per set call).
	function( "b3World_SetCustomFilterCallback(worldId, callback)", +[]( b3WorldId worldId, val cb )
	{
		val* held = new val( cb );
		b3World_SetCustomFilterCallback( worldId,
			[]( b3ShapeId a, b3ShapeId b, void* ctx ) -> bool
			{ val r = ( *static_cast<val*>( ctx ) )( a, b ); return r.isUndefined() ? true : r.as<bool>(); },
			held );
	} );
	// Pre-solve callback runs on worker threads in the MT build.
	function( "b3World_SetPreSolveCallback(worldId, callback)", +[]( b3WorldId worldId, val cb )
	{
		val* held = new val( cb );
		b3World_SetPreSolveCallback( worldId,
			[]( b3ShapeId a, b3ShapeId b, b3Pos point, b3Vec3 normal, void* ctx ) -> bool
			{ val r = ( *static_cast<val*>( ctx ) )( a, b, point, normal ); return r.isUndefined() ? true : r.as<bool>(); },
			held );
	} );

	// Shapes passed as point-cloud proxies (Float32Array of local points + radius), matching b3ShapeProxy.
	enum_<b3TOIState>( "b3TOIState" )
		.value( "b3_toiStateUnknown", b3_toiStateUnknown )
		.value( "b3_toiStateFailed", b3_toiStateFailed )
		.value( "b3_toiStateOverlapped", b3_toiStateOverlapped )
		.value( "b3_toiStateHit", b3_toiStateHit )
		.value( "b3_toiStateSeparated", b3_toiStateSeparated );

	value_object<b3DistanceOutput>( "b3DistanceOutput" )
		.field( "pointA", &b3DistanceOutput::pointA )
		.field( "pointB", &b3DistanceOutput::pointB )
		.field( "normal", &b3DistanceOutput::normal )
		.field( "distance", &b3DistanceOutput::distance )
		.field( "iterations", &b3DistanceOutput::iterations )
		.field( "simplexCount", &b3DistanceOutput::simplexCount );

	// b3CastOutput === b3WorldCastOutput in float mode (already registered).

	value_object<b3Sweep>( "b3Sweep" )
		.field( "localCenter", &b3Sweep::localCenter )
		.field( "c1", &b3Sweep::c1 )
		.field( "c2", &b3Sweep::c2 )
		.field( "q1", &b3Sweep::q1 )
		.field( "q2", &b3Sweep::q2 );

	value_object<b3TOIOutput>( "b3TOIOutput" )
		.field( "state", &b3TOIOutput::state )
		.field( "point", &b3TOIOutput::point )
		.field( "normal", &b3TOIOutput::normal )
		.field( "fraction", &b3TOIOutput::fraction )
		.field( "distance", &b3TOIOutput::distance )
		.field( "distanceIterations", &b3TOIOutput::distanceIterations )
		.field( "pushBackIterations", &b3TOIOutput::pushBackIterations )
		.field( "rootIterations", &b3TOIOutput::rootIterations )
		.field( "usedFallback", &b3TOIOutput::usedFallback );

	// GJK closest points/distance between two convex point clouds. transformB is
	// shape B's pose in shape A's frame.
	function( "b3ShapeDistance(pointsA, radiusA, pointsB, radiusB, transformB, useRadii)",
		+[]( val pointsA, float radiusA, val pointsB, float radiusB, b3Transform transformB, bool useRadii ) -> b3DistanceOutput
		{
			std::vector<float> fa = convertJSArrayToNumberVector<float>( pointsA );
			std::vector<float> fb = convertJSArrayToNumberVector<float>( pointsB );
			b3DistanceInput input = {};
			input.proxyA = { reinterpret_cast<const b3Vec3*>( fa.data() ), (int)( fa.size() / 3 ), radiusA };
			input.proxyB = { reinterpret_cast<const b3Vec3*>( fb.data() ), (int)( fb.size() / 3 ), radiusB };
			input.transform = transformB;
			input.useRadii = useRadii;
			b3SimplexCache cache = {};
			return b3ShapeDistance( &input, &cache, nullptr, 0 );
		} );

	// Convex cast of shape B (swept by translationB) against shape A.
	function( "b3ShapeCast(pointsA, radiusA, pointsB, radiusB, transformB, translationB, maxFraction, canEncroach)",
		+[]( val pointsA, float radiusA, val pointsB, float radiusB, b3Transform transformB, b3Vec3 translationB, float maxFraction, bool canEncroach ) -> b3CastOutput
		{
			std::vector<float> fa = convertJSArrayToNumberVector<float>( pointsA );
			std::vector<float> fb = convertJSArrayToNumberVector<float>( pointsB );
			b3ShapeCastPairInput input = {};
			input.proxyA = { reinterpret_cast<const b3Vec3*>( fa.data() ), (int)( fa.size() / 3 ), radiusA };
			input.proxyB = { reinterpret_cast<const b3Vec3*>( fb.data() ), (int)( fb.size() / 3 ), radiusB };
			input.transform = transformB;
			input.translationB = translationB;
			input.maxFraction = maxFraction;
			input.canEncroach = canEncroach;
			return b3ShapeCast( &input );
		} );

	// Time of impact between two swept convex shapes.
	function( "b3TimeOfImpact(pointsA, radiusA, pointsB, radiusB, sweepA, sweepB, maxFraction)",
		+[]( val pointsA, float radiusA, val pointsB, float radiusB, b3Sweep sweepA, b3Sweep sweepB, float maxFraction ) -> b3TOIOutput
		{
			std::vector<float> fa = convertJSArrayToNumberVector<float>( pointsA );
			std::vector<float> fb = convertJSArrayToNumberVector<float>( pointsB );
			b3TOIInput input = {};
			input.proxyA = { reinterpret_cast<const b3Vec3*>( fa.data() ), (int)( fa.size() / 3 ), radiusA };
			input.proxyB = { reinterpret_cast<const b3Vec3*>( fb.data() ), (int)( fb.size() / 3 ), radiusB };
			input.sweepA = sweepA;
			input.sweepB = sweepB;
			input.maxFraction = maxFraction;
			return b3TimeOfImpact( &input );
		} );

	// --- manifold generation (b3Collide*). Collide two shapes, with shape B
	// given relative to A via transformBtoA, returning { normal, points:[{point,
	// separation}] } in shape A's local frame. Up to 4 points. Compute transformBtoA
	// in JS (inverse of A times B) — no math-op wasm crossing. ---
	function( "b3CollideSpheres(sphereA, sphereB, transformB)", +[]( b3Sphere a, b3Sphere b, b3Transform xf ) -> val
	{
		b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;
		b3CollideSpheres( &m, 4, &a, &b, xf );
		return localManifoldToVal( m );
	} );
	function( "b3CollideCapsuleAndSphere(capsuleA, sphereB, transformB)", +[]( b3Capsule a, b3Sphere b, b3Transform xf ) -> val
	{
		b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;
		b3CollideCapsuleAndSphere( &m, 4, &a, &b, xf );
		return localManifoldToVal( m );
	} );
	function( "b3CollideHullAndSphere(hullA, sphereB, transformB)", +[]( b3HullData* a, b3Sphere b, b3Transform xf ) -> val
	{
		b3SimplexCache cache = {}; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;
		b3CollideHullAndSphere( &m, 4, a, &b, xf, &cache );
		return localManifoldToVal( m );
	}, allow_raw_pointers() );
	function( "b3CollideCapsules(capsuleA, capsuleB, transformB)", +[]( b3Capsule a, b3Capsule b, b3Transform xf ) -> val
	{
		b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;
		b3CollideCapsules( &m, 4, &a, &b, xf );
		return localManifoldToVal( m );
	} );
	function( "b3CollideHullAndCapsule(hullA, capsuleB, transformB)", +[]( b3HullData* a, b3Capsule b, b3Transform xf ) -> val
	{
		b3SimplexCache cache = {}; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;
		b3CollideHullAndCapsule( &m, 4, a, &b, xf, &cache );
		return localManifoldToVal( m );
	}, allow_raw_pointers() );
	function( "b3CollideHulls(hullA, hullB, transformB)", +[]( b3HullData* a, b3HullData* b, b3Transform xf ) -> val
	{
		b3SATCache cache = {}; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;
		b3CollideHulls( &m, 4, a, b, xf, &cache );
		return localManifoldToVal( m );
	}, allow_raw_pointers() );
	// Triangle-vs-convex manifolds: the normal points from the triangle to the other shape.
	function( "b3CollideTriangleAndCapsule(v1, v2, v3, capsuleB)", +[]( b3Vec3 v1, b3Vec3 v2, b3Vec3 v3, b3Capsule b ) -> val
	{
		b3Vec3 tri[3] = { v1, v2, v3 }; b3SimplexCache cache = {}; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;
		b3CollideTriangleAndCapsule( &m, 4, tri, &b, &cache );
		return localManifoldToVal( m );
	} );
	function( "b3CollideTriangleAndHull(v1, v2, v3, triangleFlags, hullB, enableSpeculative)",
		+[]( b3Vec3 v1, b3Vec3 v2, b3Vec3 v3, int triangleFlags, b3HullData* b, bool enableSpeculative ) -> val
	{
		b3SATCache cache = {}; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;
		b3CollideTriangleAndHull( &m, 4, v1, v2, v3, triangleFlags, b, &cache, enableSpeculative );
		return localManifoldToVal( m );
	}, allow_raw_pointers() );
	function( "b3CollideTriangleAndSphere(v1, v2, v3, sphereB)", +[]( b3Vec3 v1, b3Vec3 v2, b3Vec3 v3, b3Sphere b ) -> val
	{
		b3Vec3 tri[3] = { v1, v2, v3 }; b3LocalManifoldPoint pts[4] = {}; b3LocalManifold m = {}; m.points = pts;
		b3CollideTriangleAndSphere( &m, 4, tri, &b );
		return localManifoldToVal( m );
	} );

	// Compute mass-data / AABB of a primitive shape without attaching it to a body.
	function( "b3ComputeSphereMass(sphere, density)", +[]( b3Sphere s, float density ) { return b3ComputeSphereMass( &s, density ); } );
	function( "b3ComputeCapsuleMass(capsule, density)", +[]( b3Capsule c, float density ) { return b3ComputeCapsuleMass( &c, density ); } );
	function( "b3ComputeHullMass(hull, density)", +[]( b3HullData* h, float density ) { return b3ComputeHullMass( h, density ); }, allow_raw_pointers() );
	function( "b3ComputeSphereAABB(sphere, transform)", +[]( b3Sphere s, b3Transform t ) { return b3ComputeSphereAABB( &s, t ); } );
	function( "b3ComputeCapsuleAABB(capsule, transform)", +[]( b3Capsule c, b3Transform t ) { return b3ComputeCapsuleAABB( &c, t ); } );
	function( "b3ComputeHullAABB(hull, transform)", +[]( b3HullData* h, b3Transform t ) { return b3ComputeHullAABB( h, t ); }, allow_raw_pointers() );

	// world timing profile (per-step milliseconds)
	value_object<b3Profile>( "b3Profile" )
		.field( "step", &b3Profile::step )
		.field( "pairs", &b3Profile::pairs )
		.field( "collide", &b3Profile::collide )
		.field( "solve", &b3Profile::solve )
		.field( "solverSetup", &b3Profile::solverSetup )
		.field( "constraints", &b3Profile::constraints )
		.field( "prepareConstraints", &b3Profile::prepareConstraints )
		.field( "integrateVelocities", &b3Profile::integrateVelocities )
		.field( "warmStart", &b3Profile::warmStart )
		.field( "solveImpulses", &b3Profile::solveImpulses )
		.field( "integratePositions", &b3Profile::integratePositions )
		.field( "relaxImpulses", &b3Profile::relaxImpulses )
		.field( "restitution", &b3Profile::restitution )
		.field( "storeImpulses", &b3Profile::storeImpulses )
		.field( "splitIslands", &b3Profile::splitIslands )
		.field( "transforms", &b3Profile::transforms )
		.field( "sensorHits", &b3Profile::sensorHits )
		.field( "jointEvents", &b3Profile::jointEvents )
		.field( "hitEvents", &b3Profile::hitEvents )
		.field( "refit", &b3Profile::refit )
		.field( "bullets", &b3Profile::bullets )
		.field( "sleepIslands", &b3Profile::sleepIslands )
		.field( "sensors", &b3Profile::sensors );
	function( "b3World_GetProfile(worldId)", &b3World_GetProfile );

	// --- live contact / sensor data getters ---
	// Reusable, wasm-backed contact buffer for the per-frame path (see the
	// ContactsBuffer struct). The JS facade wraps this as createContactsBuffer/
	// getShapeContactData/getBodyContactData/destroyContactsBuffer.
	// Reusable, wasm-backed contact buffer. Read it in JS with the facade helpers
	// createContactsBuffer / getShapeContactData / getBodyContactData /
	// createContact / getContactAt / createManifold / getManifoldAt. Anchors are
	// offsets from each body's centre of mass, in world orientation. There is no
	// array-returning accessor: building JS objects for every contact each frame
	// is unusably slow, so the reusable zero-alloc buffer is the only path.
	class_<ContactsBuffer>( "ContactsBufferImpl" )
		.constructor<>()
		.function( "loadFromShape", &ContactsBuffer::loadFromShape )
		.function( "loadFromBody", &ContactsBuffer::loadFromBody )
		.function( "count", &ContactsBuffer::getCount )
		.function( "contactsPtr", &ContactsBuffer::contactsPtr )
		.function( "manifoldsF32Ptr", &ContactsBuffer::manifoldsF32Ptr )
		.function( "manifoldsI32Ptr", &ContactsBuffer::manifoldsI32Ptr )
		.function( "pointsF32Ptr", &ContactsBuffer::pointsF32Ptr )
		.function( "pointsI32Ptr", &ContactsBuffer::pointsI32Ptr );

	// sensor overlaps: packed buffer { count, data } of visitor shape ids (3
	// int32 per id) currently inside this sensor. Read with getShapeIdAt.
	ret_function( "b3Shape_GetSensorData(shapeId): ShapeIdBuffer", +[]( b3ShapeId shapeId ) -> val
	{
		std::vector<b3ShapeId> ids( (size_t)b3Shape_GetSensorCapacity( shapeId ) );
		int n = ids.empty() ? 0 : b3Shape_GetSensorData( shapeId, ids.data(), (int)ids.size() );
		std::vector<int32_t> packed;
		packed.reserve( (size_t)n * layout::shapeId );
		for ( int i = 0; i < n; ++i )
			packed.insert( packed.end(), { ids[i].index1, ids[i].world0, ids[i].generation } );
		val out = val::object();
		out.set( "count", n );
		out.set( "data", toI32( packed ) );
		return out;
	} );

	value_object<b3ExplosionDef>( "b3ExplosionDef" )
		.field( "maskBits", &b3ExplosionDef::maskBits )
		.field( "position", &b3ExplosionDef::position )
		.field( "radius", &b3ExplosionDef::radius )
		.field( "falloff", &b3ExplosionDef::falloff )
		.field( "impulsePerArea", &b3ExplosionDef::impulsePerArea );
	function( "b3DefaultExplosionDef()", &b3DefaultExplosionDef );
	function( "b3World_Explode(worldId, explosionDef)", +[]( b3WorldId worldId, b3ExplosionDef def ) { b3World_Explode( worldId, &def ); } );

	function( "b3World_OverlapShape(worldId, origin, points, radius, filter, callback)",
		+[]( b3WorldId worldId, b3Vec3 origin, val points, float radius, b3QueryFilter filter, val cb )
		{
			std::vector<float> f = convertJSArrayToNumberVector<float>( points );
			b3ShapeProxy proxy{ reinterpret_cast<const b3Vec3*>( f.data() ), (int)( f.size() / 3 ), radius };
			b3World_OverlapShape( worldId, origin, &proxy, filter,
				[]( b3ShapeId shapeId, void* ctx ) -> bool
				{
					val r = ( *static_cast<val*>( ctx ) )( shapeId );
					return r.isUndefined() ? true : r.as<bool>();
				},
				&cb );
		} );
	function( "b3World_CastShape(worldId, origin, points, radius, translation, filter, callback)",
		+[]( b3WorldId worldId, b3Vec3 origin, val points, float radius, b3Vec3 translation, b3QueryFilter filter, val cb )
		{
			std::vector<float> f = convertJSArrayToNumberVector<float>( points );
			b3ShapeProxy proxy{ reinterpret_cast<const b3Vec3*>( f.data() ), (int)( f.size() / 3 ), radius };
			b3World_CastShape( worldId, origin, &proxy, translation, filter,
				[]( b3ShapeId shapeId, b3Pos point, b3Vec3 normal, float fraction, uint64_t, int, int, void* ctx ) -> float
				{
					val r = ( *static_cast<val*>( ctx ) )( shapeId, point, normal, fraction );
					return r.isUndefined() ? 1.0f : r.as<float>();
				},
				&cb );
		} );

	value_object<b3BodyCastResult>( "b3BodyCastResult" )
		.field( "shapeId", &b3BodyCastResult::shapeId )
		.field( "point", &b3BodyCastResult::point )
		.field( "normal", &b3BodyCastResult::normal )
		.field( "fraction", &b3BodyCastResult::fraction )
		.field( "triangleIndex", &b3BodyCastResult::triangleIndex )
		.field( "iterations", &b3BodyCastResult::iterations )
		.field( "hit", &b3BodyCastResult::hit );
	function( "b3Body_CastRay(bodyId, origin, translation, filter, maxFraction, bodyTransform)", +[]( b3BodyId bodyId, b3Vec3 origin, b3Vec3 translation, b3QueryFilter filter, float maxFraction, b3Transform bodyTransform ) -> b3BodyCastResult
	{ return b3Body_CastRay( bodyId, origin, translation, filter, maxFraction, bodyTransform ); } );
	function( "b3Body_CastShape(bodyId, origin, points, radius, translation, filter, maxFraction, canEncroach, bodyTransform)", +[]( b3BodyId bodyId, b3Vec3 origin, val points, float radius, b3Vec3 translation, b3QueryFilter filter, float maxFraction, bool canEncroach, b3Transform bodyTransform ) -> b3BodyCastResult
	{
		std::vector<float> f = convertJSArrayToNumberVector<float>( points );
		b3ShapeProxy proxy{ reinterpret_cast<const b3Vec3*>( f.data() ), (int)( f.size() / 3 ), radius };
		return b3Body_CastShape( bodyId, origin, &proxy, translation, filter, maxFraction, canEncroach, bodyTransform );
	} );
	function( "b3Body_OverlapShape(bodyId, origin, points, radius, filter, bodyTransform)", +[]( b3BodyId bodyId, b3Vec3 origin, val points, float radius, b3QueryFilter filter, b3Transform bodyTransform ) -> bool
	{
		std::vector<float> f = convertJSArrayToNumberVector<float>( points );
		b3ShapeProxy proxy{ reinterpret_cast<const b3Vec3*>( f.data() ), (int)( f.size() / 3 ), radius };
		return b3Body_OverlapShape( bodyId, origin, &proxy, filter, bodyTransform );
	} );
	// Character mover vs one body at a given transform (e.g. a dynamic body's
	// predicted pose). box3d reports at most one plane per shape, so the shape count
	// is the capacity. Returns { count, data, shapeIds }: data is the PlaneResultBuffer
	// layout, shapeIds the ShapeIdBuffer layout; read with getBodyPlaneResultAt.
	ret_function( "b3Body_CollideMover(bodyId, origin, mover, filter, bodyTransform): BodyPlaneResultBuffer",
		+[]( b3BodyId bodyId, b3Vec3 origin, b3Capsule mover, b3QueryFilter filter, b3Transform bodyTransform ) -> val
	{
		std::vector<b3BodyPlaneResult> results( (size_t)b3Body_GetShapeCount( bodyId ) );
		int n = results.empty() ? 0 : b3Body_CollideMover( bodyId, results.data(), (int)results.size(), origin, &mover, filter, bodyTransform );
		std::vector<float> planes;
		std::vector<int32_t> ids;
		planes.reserve( (size_t)n * layout::plane );
		ids.reserve( (size_t)n * layout::shapeId );
		for ( int i = 0; i < n; ++i )
		{
			const b3PlaneResult& pr = results[i].result;
			planes.insert( planes.end(), {
				pr.plane.normal.x, pr.plane.normal.y, pr.plane.normal.z, pr.plane.offset,
				pr.point.x, pr.point.y, pr.point.z } );
			const b3ShapeId& id = results[i].shapeId;
			ids.insert( ids.end(), { id.index1, id.world0, id.generation } );
		}
		val out = val::object();
		out.set( "count", n );
		out.set( "data", toF32( planes ) );
		out.set( "shapeIds", toI32( ids ) );
		return out;
	} );

	register_vector<b3ShapeId>( "b3ShapeIdVector" );
	register_vector<b3JointId>( "b3JointIdVector" );

	function( "b3Body_SetType(bodyId, type)", &b3Body_SetType );
	function( "b3Body_SetName(bodyId, name)", +[]( b3BodyId bodyId, std::string name ) { b3Body_SetName( bodyId, name.c_str() ); } );
	function( "b3Body_GetName(bodyId)", +[]( b3BodyId bodyId ) { const char* n = b3Body_GetName( bodyId ); return std::string( n ? n : "" ); } );

	out_function( "b3Body_GetLocalPoint(out, bodyId, worldPoint)", out_desc::Vec3, out_desc::Pass, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId, b3Vec3 worldPoint ) { writeVec3( out, b3Body_GetLocalPoint( bodyId, worldPoint ) ); } );
	out_function( "b3Body_GetWorldPoint(out, bodyId, localPoint)", out_desc::Vec3, out_desc::Pass, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId, b3Vec3 localPoint ) { writeVec3( out, b3Body_GetWorldPoint( bodyId, localPoint ) ); } );
	out_function( "b3Body_GetLocalVector(out, bodyId, worldVector)", out_desc::Vec3, out_desc::Pass, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId, b3Vec3 worldVector ) { writeVec3( out, b3Body_GetLocalVector( bodyId, worldVector ) ); } );
	out_function( "b3Body_GetWorldVector(out, bodyId, localVector)", out_desc::Vec3, out_desc::Pass, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId, b3Vec3 localVector ) { writeVec3( out, b3Body_GetWorldVector( bodyId, localVector ) ); } );

	function( "b3Body_SetLinearVelocity(bodyId, linearVelocity)", &b3Body_SetLinearVelocity );
	function( "b3Body_SetAngularVelocity(bodyId, angularVelocity)", &b3Body_SetAngularVelocity );
	function( "b3Body_SetTargetTransform(bodyId, target, timeStep, wake)", &b3Body_SetTargetTransform );
	out_function( "b3Body_GetLocalPointVelocity(out, bodyId, localPoint)", out_desc::Vec3, out_desc::Pass, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId, b3Vec3 localPoint ) { writeVec3( out, b3Body_GetLocalPointVelocity( bodyId, localPoint ) ); } );
	out_function( "b3Body_GetWorldPointVelocity(out, bodyId, worldPoint)", out_desc::Vec3, out_desc::Pass, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId, b3Vec3 worldPoint ) { writeVec3( out, b3Body_GetWorldPointVelocity( bodyId, worldPoint ) ); } );

	function( "b3Body_ApplyForce(bodyId, force, point, wake)", &b3Body_ApplyForce );
	function( "b3Body_ApplyForceToCenter(bodyId, force, wake)", &b3Body_ApplyForceToCenter );
	function( "b3Body_ApplyTorque(bodyId, torque, wake)", &b3Body_ApplyTorque );
	function( "b3Body_ApplyLinearImpulse(bodyId, impulse, point, wake)", &b3Body_ApplyLinearImpulse );
	function( "b3Body_ApplyLinearImpulseToCenter(bodyId, impulse, wake)", &b3Body_ApplyLinearImpulseToCenter );
	function( "b3Body_ApplyAngularImpulse(bodyId, impulse, wake)", &b3Body_ApplyAngularImpulse );
	// Persistent forces: kept in a bindings-side table and re-applied (wake=false) by
	// b3World_Step before every step until changed, cleared, or the body is destroyed.
	// force/torque are world-space; point is in body-local coordinates, null = center
	// of mass. Setting a non-zero value wakes the body once.
	function( "b3Body_SetConstantForce(bodyId, force, point)", &setConstantForce );
	function( "b3Body_SetConstantTorque(bodyId, torque)", &setConstantTorque );
	function( "b3Body_ClearConstantForces(bodyId)", &clearConstantForces );

	function( "b3Body_GetMass(bodyId)", &b3Body_GetMass );
	function( "b3Body_GetInverseMass(bodyId)", &b3Body_GetInverseMass );
	out_function( "b3Body_GetLocalCenter(out, bodyId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId ) { writeVec3( out, b3Body_GetLocalCenter( bodyId ) ); } );
	out_function( "b3Body_GetWorldCenter(out, bodyId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId ) { writeVec3( out, b3Body_GetWorldCenter( bodyId ) ); } );
	function( "b3Body_ApplyMassFromShapes(bodyId)", &b3Body_ApplyMassFromShapes );

	function( "b3Body_SetLinearDamping(bodyId, linearDamping)", &b3Body_SetLinearDamping );
	function( "b3Body_GetLinearDamping(bodyId)", &b3Body_GetLinearDamping );
	function( "b3Body_SetAngularDamping(bodyId, angularDamping)", &b3Body_SetAngularDamping );
	function( "b3Body_GetAngularDamping(bodyId)", &b3Body_GetAngularDamping );
	function( "b3Body_SetGravityScale(bodyId, gravityScale)", &b3Body_SetGravityScale );
	function( "b3Body_GetGravityScale(bodyId)", &b3Body_GetGravityScale );

	function( "b3Body_IsAwake(bodyId)", &b3Body_IsAwake );
	function( "b3Body_SetAwake(bodyId, awake)", &b3Body_SetAwake );
	function( "b3Body_EnableSleep(bodyId, enableSleep)", &b3Body_EnableSleep );
	function( "b3Body_IsSleepEnabled(bodyId)", &b3Body_IsSleepEnabled );
	function( "b3Body_SetSleepThreshold(bodyId, sleepThreshold)", &b3Body_SetSleepThreshold );
	function( "b3Body_GetSleepThreshold(bodyId)", &b3Body_GetSleepThreshold );

	function( "b3Body_IsEnabled(bodyId)", &b3Body_IsEnabled );
	function( "b3Body_Disable(bodyId)", &b3Body_Disable );
	function( "b3Body_Enable(bodyId)", &b3Body_Enable );
	function( "b3Body_SetMotionLocks(bodyId, locks)", &b3Body_SetMotionLocks );
	function( "b3Body_GetMotionLocks(bodyId)", &b3Body_GetMotionLocks );
	function( "b3Body_SetBullet(bodyId, flag)", &b3Body_SetBullet );
	function( "b3Body_IsBullet(bodyId)", &b3Body_IsBullet );
	function( "b3Body_EnableContactRecycling(bodyId, flag)", &b3Body_EnableContactRecycling );
	function( "b3Body_IsContactRecyclingEnabled(bodyId)", &b3Body_IsContactRecyclingEnabled );
	function( "b3Body_EnableHitEvents(bodyId, enableHitEvents)", &b3Body_EnableHitEvents );

	function( "b3Body_GetWorld(bodyId)", &b3Body_GetWorld );
	function( "b3Body_GetShapeCount(bodyId)", &b3Body_GetShapeCount );
	function( "b3Body_GetShapes(bodyId)", +[]( b3BodyId bodyId )
	{
		std::vector<b3ShapeId> out( (size_t)b3Body_GetShapeCount( bodyId ) );
		if ( !out.empty() ) b3Body_GetShapes( bodyId, out.data(), (int)out.size() );
		return out;
	} );
	function( "b3Body_GetJointCount(bodyId)", &b3Body_GetJointCount );
	function( "b3Body_GetJoints(bodyId)", +[]( b3BodyId bodyId )
	{
		std::vector<b3JointId> out( (size_t)b3Body_GetJointCount( bodyId ) );
		if ( !out.empty() ) b3Body_GetJoints( bodyId, out.data(), (int)out.size() );
		return out;
	} );
	out_function( "b3Body_ComputeAABB(out, bodyId)", out_desc::AABB, out_desc::Pass, +[]( uintptr_t out, b3BodyId bodyId ) { writeAABB( out, b3Body_ComputeAABB( bodyId ) ); } );

	function( "b3Shape_GetType(shapeId)", &b3Shape_GetType );
	function( "b3Shape_GetBody(shapeId)", &b3Shape_GetBody );
	function( "b3Shape_GetWorld(shapeId)", &b3Shape_GetWorld );
	function( "b3Shape_IsSensor(shapeId)", &b3Shape_IsSensor );

	function( "b3Shape_SetDensity(shapeId, density, updateBodyMass)", &b3Shape_SetDensity );
	function( "b3Shape_GetDensity(shapeId)", &b3Shape_GetDensity );
	function( "b3Shape_SetFriction(shapeId, friction)", &b3Shape_SetFriction );
	function( "b3Shape_GetFriction(shapeId)", &b3Shape_GetFriction );
	function( "b3Shape_SetRestitution(shapeId, restitution)", &b3Shape_SetRestitution );
	function( "b3Shape_GetRestitution(shapeId)", &b3Shape_GetRestitution );
	function( "b3Shape_SetSurfaceMaterial(shapeId, surfaceMaterial)", &b3Shape_SetSurfaceMaterial );
	function( "b3Shape_GetSurfaceMaterial(shapeId)", &b3Shape_GetSurfaceMaterial );
	function( "b3Shape_GetFilter(shapeId)", &b3Shape_GetFilter );
	function( "b3Shape_SetFilter(shapeId, filter, invokeContacts)", &b3Shape_SetFilter );

	function( "b3Shape_EnableSensorEvents(shapeId, flag)", &b3Shape_EnableSensorEvents );
	function( "b3Shape_AreSensorEventsEnabled(shapeId)", &b3Shape_AreSensorEventsEnabled );
	function( "b3Shape_EnableContactEvents(shapeId, flag)", &b3Shape_EnableContactEvents );
	function( "b3Shape_AreContactEventsEnabled(shapeId)", &b3Shape_AreContactEventsEnabled );
	function( "b3Shape_EnablePreSolveEvents(shapeId, flag)", &b3Shape_EnablePreSolveEvents );
	function( "b3Shape_ArePreSolveEventsEnabled(shapeId)", &b3Shape_ArePreSolveEventsEnabled );
	function( "b3Shape_EnableHitEvents(shapeId, flag)", &b3Shape_EnableHitEvents );
	function( "b3Shape_AreHitEventsEnabled(shapeId)", &b3Shape_AreHitEventsEnabled );

	function( "b3Shape_GetSphere(shapeId)", &b3Shape_GetSphere );
	function( "b3Shape_GetCapsule(shapeId)", &b3Shape_GetCapsule );
	// The returned view aliases box3d memory — copy it before the shape changes.
	function( "b3Shape_GetHullVertices(shapeId)", +[]( b3ShapeId shapeId ) -> val
	{
		const b3HullData* hull = b3Shape_GetHull( shapeId );
		if ( hull == nullptr ) return val::global( "Float32Array" ).new_( 0 );
		const b3Vec3* pts = b3GetHullPoints( hull );
		return val( typed_memory_view( (size_t)hull->vertexCount * 3, reinterpret_cast<const float*>( pts ) ) );
	} );
	function( "b3Shape_SetSphere(shapeId, sphere)", +[]( b3ShapeId shapeId, b3Sphere sphere ) { b3Shape_SetSphere( shapeId, &sphere ); } );
	function( "b3Shape_SetCapsule(shapeId, capsule)", +[]( b3ShapeId shapeId, b3Capsule capsule ) { b3Shape_SetCapsule( shapeId, &capsule ); } );
	// 1:1 with C: swap the shape's geometry for a copy of hull. Mass is unchanged.
	function( "b3Shape_SetHull(shapeId, hull)", +[]( b3ShapeId shapeId, b3HullData* hull ) { b3Shape_SetHull( shapeId, hull ); },
		allow_raw_pointers() );
	// Convenience: hull baked with transform/scale (no temporary hull for JS to free), optional mass
	// update. Returns false, leaving the shape unchanged, if the transformed hull is degenerate.
	function( "b3Shape_SetBakedHull(shapeId, hull, transform, scale, updateBodyMass)", &setShapeBakedHull, allow_raw_pointers() );
	function( "b3Shape_Enable(shapeId)", &b3Shape_Enable );
	function( "b3Shape_Disable(shapeId)", &b3Shape_Disable );
	function( "b3Shape_IsEnabled(shapeId)", &b3Shape_IsEnabled );

	out_function( "b3Shape_GetAABB(out, shapeId)", out_desc::AABB, out_desc::Pass, +[]( uintptr_t out, b3ShapeId shapeId ) { writeAABB( out, b3Shape_GetAABB( shapeId ) ); } );
	out_function( "b3Shape_GetClosestPoint(out, shapeId, target)", out_desc::Vec3, out_desc::Pass, out_desc::Pass, +[]( uintptr_t out, b3ShapeId shapeId, b3Vec3 target ) { writeVec3( out, b3Shape_GetClosestPoint( shapeId, target ) ); } );
	function( "b3Shape_ApplyWind(shapeId, wind, drag, lift, maxSpeed, wake)", &b3Shape_ApplyWind );
	function( "b3DestroyShape(shapeId, updateBodyMass)", &b3DestroyShape );

	value_object<b3JointDef>( "b3JointDef" )
		.field( "bodyIdA", &b3JointDef::bodyIdA )
		.field( "bodyIdB", &b3JointDef::bodyIdB )
		.field( "localFrameA", &b3JointDef::localFrameA )
		.field( "localFrameB", &b3JointDef::localFrameB )
		.field( "forceThreshold", &b3JointDef::forceThreshold )
		.field( "torqueThreshold", &b3JointDef::torqueThreshold )
		.field( "constraintHertz", &b3JointDef::constraintHertz )
		.field( "constraintDampingRatio", &b3JointDef::constraintDampingRatio )
		.field( "drawScale", &b3JointDef::drawScale )
		.field( "collideConnected", &b3JointDef::collideConnected )
		.field( "internalValue", &b3JointDef::internalValue );

	value_object<b3DistanceJointDef>( "b3DistanceJointDef" )
		.field( "base", &b3DistanceJointDef::base )
		.field( "length", &b3DistanceJointDef::length )
		.field( "enableSpring", &b3DistanceJointDef::enableSpring )
		.field( "lowerSpringForce", &b3DistanceJointDef::lowerSpringForce )
		.field( "upperSpringForce", &b3DistanceJointDef::upperSpringForce )
		.field( "hertz", &b3DistanceJointDef::hertz )
		.field( "dampingRatio", &b3DistanceJointDef::dampingRatio )
		.field( "enableLimit", &b3DistanceJointDef::enableLimit )
		.field( "minLength", &b3DistanceJointDef::minLength )
		.field( "maxLength", &b3DistanceJointDef::maxLength )
		.field( "enableMotor", &b3DistanceJointDef::enableMotor )
		.field( "maxMotorForce", &b3DistanceJointDef::maxMotorForce )
		.field( "motorSpeed", &b3DistanceJointDef::motorSpeed )
		.field( "springStiffness", &b3DistanceJointDef::springStiffness )
		.field( "springDamping", &b3DistanceJointDef::springDamping );

	value_object<b3RevoluteJointDef>( "b3RevoluteJointDef" )
		.field( "base", &b3RevoluteJointDef::base )
		.field( "targetAngle", &b3RevoluteJointDef::targetAngle )
		.field( "enableSpring", &b3RevoluteJointDef::enableSpring )
		.field( "hertz", &b3RevoluteJointDef::hertz )
		.field( "dampingRatio", &b3RevoluteJointDef::dampingRatio )
		.field( "enableLimit", &b3RevoluteJointDef::enableLimit )
		.field( "lowerAngle", &b3RevoluteJointDef::lowerAngle )
		.field( "upperAngle", &b3RevoluteJointDef::upperAngle )
		.field( "enableMotor", &b3RevoluteJointDef::enableMotor )
		.field( "maxMotorTorque", &b3RevoluteJointDef::maxMotorTorque )
		.field( "motorSpeed", &b3RevoluteJointDef::motorSpeed );

	value_object<b3PrismaticJointDef>( "b3PrismaticJointDef" )
		.field( "base", &b3PrismaticJointDef::base )
		.field( "enableSpring", &b3PrismaticJointDef::enableSpring )
		.field( "hertz", &b3PrismaticJointDef::hertz )
		.field( "dampingRatio", &b3PrismaticJointDef::dampingRatio )
		.field( "targetTranslation", &b3PrismaticJointDef::targetTranslation )
		.field( "enableLimit", &b3PrismaticJointDef::enableLimit )
		.field( "lowerTranslation", &b3PrismaticJointDef::lowerTranslation )
		.field( "upperTranslation", &b3PrismaticJointDef::upperTranslation )
		.field( "enableMotor", &b3PrismaticJointDef::enableMotor )
		.field( "maxMotorForce", &b3PrismaticJointDef::maxMotorForce )
		.field( "motorSpeed", &b3PrismaticJointDef::motorSpeed );

	value_object<b3CylindricalJointDef>( "b3CylindricalJointDef" )
		.field( "base", &b3CylindricalJointDef::base )
		.field( "localSlideAxisA", &b3CylindricalJointDef::localSlideAxisA )
		.field( "enableSpring", &b3CylindricalJointDef::enableSpring )
		.field( "hertz", &b3CylindricalJointDef::hertz )
		.field( "dampingRatio", &b3CylindricalJointDef::dampingRatio )
		.field( "targetTranslation", &b3CylindricalJointDef::targetTranslation )
		.field( "enableLimit", &b3CylindricalJointDef::enableLimit )
		.field( "lowerTranslation", &b3CylindricalJointDef::lowerTranslation )
		.field( "upperTranslation", &b3CylindricalJointDef::upperTranslation )
		.field( "enableMotor", &b3CylindricalJointDef::enableMotor )
		.field( "maxMotorForce", &b3CylindricalJointDef::maxMotorForce )
		.field( "motorSpeed", &b3CylindricalJointDef::motorSpeed )
		.field( "enableAngularSpring", &b3CylindricalJointDef::enableAngularSpring )
		.field( "angularHertz", &b3CylindricalJointDef::angularHertz )
		.field( "angularDampingRatio", &b3CylindricalJointDef::angularDampingRatio )
		.field( "targetAngle", &b3CylindricalJointDef::targetAngle )
		.field( "enableAngularLimit", &b3CylindricalJointDef::enableAngularLimit )
		.field( "lowerAngle", &b3CylindricalJointDef::lowerAngle )
		.field( "upperAngle", &b3CylindricalJointDef::upperAngle )
		.field( "enableAngularMotor", &b3CylindricalJointDef::enableAngularMotor )
		.field( "maxMotorTorque", &b3CylindricalJointDef::maxMotorTorque )
		.field( "angularMotorSpeed", &b3CylindricalJointDef::angularMotorSpeed );

	value_object<b3WheelJointDef>( "b3WheelJointDef" )
		.field( "base", &b3WheelJointDef::base )
		.field( "enableSuspensionSpring", &b3WheelJointDef::enableSuspensionSpring )
		.field( "suspensionHertz", &b3WheelJointDef::suspensionHertz )
		.field( "suspensionDampingRatio", &b3WheelJointDef::suspensionDampingRatio )
		.field( "enableSuspensionLimit", &b3WheelJointDef::enableSuspensionLimit )
		.field( "lowerSuspensionLimit", &b3WheelJointDef::lowerSuspensionLimit )
		.field( "upperSuspensionLimit", &b3WheelJointDef::upperSuspensionLimit )
		.field( "enableSpinMotor", &b3WheelJointDef::enableSpinMotor )
		.field( "maxSpinTorque", &b3WheelJointDef::maxSpinTorque )
		.field( "spinSpeed", &b3WheelJointDef::spinSpeed )
		.field( "enableSteering", &b3WheelJointDef::enableSteering )
		.field( "steeringHertz", &b3WheelJointDef::steeringHertz )
		.field( "steeringDampingRatio", &b3WheelJointDef::steeringDampingRatio )
		.field( "targetSteeringAngle", &b3WheelJointDef::targetSteeringAngle )
		.field( "maxSteeringTorque", &b3WheelJointDef::maxSteeringTorque )
		.field( "enableSteeringLimit", &b3WheelJointDef::enableSteeringLimit )
		.field( "lowerSteeringLimit", &b3WheelJointDef::lowerSteeringLimit )
		.field( "upperSteeringLimit", &b3WheelJointDef::upperSteeringLimit );

	value_object<b3WeldJointDef>( "b3WeldJointDef" )
		.field( "base", &b3WeldJointDef::base )
		.field( "linearHertz", &b3WeldJointDef::linearHertz )
		.field( "angularHertz", &b3WeldJointDef::angularHertz )
		.field( "linearDampingRatio", &b3WeldJointDef::linearDampingRatio )
		.field( "angularDampingRatio", &b3WeldJointDef::angularDampingRatio );

	value_object<b3SphericalJointDef>( "b3SphericalJointDef" )
		.field( "base", &b3SphericalJointDef::base )
		.field( "enableSpring", &b3SphericalJointDef::enableSpring )
		.field( "hertz", &b3SphericalJointDef::hertz )
		.field( "dampingRatio", &b3SphericalJointDef::dampingRatio )
		.field( "targetRotation", &b3SphericalJointDef::targetRotation )
		.field( "enableConeLimit", &b3SphericalJointDef::enableConeLimit )
		.field( "coneAngle", &b3SphericalJointDef::coneAngle )
		.field( "enableTwistLimit", &b3SphericalJointDef::enableTwistLimit )
		.field( "lowerTwistAngle", &b3SphericalJointDef::lowerTwistAngle )
		.field( "upperTwistAngle", &b3SphericalJointDef::upperTwistAngle )
		.field( "enableMotor", &b3SphericalJointDef::enableMotor )
		.field( "maxMotorTorque", &b3SphericalJointDef::maxMotorTorque )
		.field( "motorVelocity", &b3SphericalJointDef::motorVelocity );

	value_object<b3MotorJointDef>( "b3MotorJointDef" )
		.field( "base", &b3MotorJointDef::base )
		.field( "linearVelocity", &b3MotorJointDef::linearVelocity )
		.field( "maxVelocityForce", &b3MotorJointDef::maxVelocityForce )
		.field( "angularVelocity", &b3MotorJointDef::angularVelocity )
		.field( "maxVelocityTorque", &b3MotorJointDef::maxVelocityTorque )
		.field( "linearHertz", &b3MotorJointDef::linearHertz )
		.field( "linearDampingRatio", &b3MotorJointDef::linearDampingRatio )
		.field( "maxSpringForce", &b3MotorJointDef::maxSpringForce )
		.field( "angularHertz", &b3MotorJointDef::angularHertz )
		.field( "angularDampingRatio", &b3MotorJointDef::angularDampingRatio )
		.field( "maxSpringTorque", &b3MotorJointDef::maxSpringTorque );

	value_object<b3ParallelJointDef>( "b3ParallelJointDef" )
		.field( "base", &b3ParallelJointDef::base )
		.field( "hertz", &b3ParallelJointDef::hertz )
		.field( "dampingRatio", &b3ParallelJointDef::dampingRatio )
		.field( "maxTorque", &b3ParallelJointDef::maxTorque );

	value_object<b3FilterJointDef>( "b3FilterJointDef" )
		.field( "base", &b3FilterJointDef::base );

	function( "b3DefaultDistanceJointDef()", &b3DefaultDistanceJointDef );
	function( "b3DefaultRevoluteJointDef()", &b3DefaultRevoluteJointDef );
	function( "b3DefaultPrismaticJointDef()", &b3DefaultPrismaticJointDef );
	function( "b3DefaultCylindricalJointDef()", &b3DefaultCylindricalJointDef );
	function( "b3DefaultWheelJointDef()", &b3DefaultWheelJointDef );
	function( "b3DefaultWeldJointDef()", &b3DefaultWeldJointDef );
	function( "b3DefaultSphericalJointDef()", &b3DefaultSphericalJointDef );
	function( "b3DefaultMotorJointDef()", &b3DefaultMotorJointDef );
	function( "b3DefaultParallelJointDef()", &b3DefaultParallelJointDef );
	function( "b3DefaultFilterJointDef()", &b3DefaultFilterJointDef );

	function( "b3CreateDistanceJoint(worldId, def)", +[]( b3WorldId w, b3DistanceJointDef d ) { return b3CreateDistanceJoint( w, &d ); } );
	function( "b3CreateRevoluteJoint(worldId, def)", +[]( b3WorldId w, b3RevoluteJointDef d ) { return b3CreateRevoluteJoint( w, &d ); } );
	function( "b3CreatePrismaticJoint(worldId, def)", +[]( b3WorldId w, b3PrismaticJointDef d ) { return b3CreatePrismaticJoint( w, &d ); } );
	function( "b3CreateCylindricalJoint(worldId, def)", +[]( b3WorldId w, b3CylindricalJointDef d ) { return b3CreateCylindricalJoint( w, &d ); } );
	function( "b3CreateWheelJoint(worldId, def)", +[]( b3WorldId w, b3WheelJointDef d ) { return b3CreateWheelJoint( w, &d ); } );
	function( "b3CreateWeldJoint(worldId, def)", +[]( b3WorldId w, b3WeldJointDef d ) { return b3CreateWeldJoint( w, &d ); } );
	function( "b3CreateSphericalJoint(worldId, def)", +[]( b3WorldId w, b3SphericalJointDef d ) { return b3CreateSphericalJoint( w, &d ); } );
	function( "b3CreateMotorJoint(worldId, def)", +[]( b3WorldId w, b3MotorJointDef d ) { return b3CreateMotorJoint( w, &d ); } );
	function( "b3CreateParallelJoint(worldId, def)", +[]( b3WorldId w, b3ParallelJointDef d ) { return b3CreateParallelJoint( w, &d ); } );
	function( "b3CreateFilterJoint(worldId, def)", +[]( b3WorldId w, b3FilterJointDef d ) { return b3CreateFilterJoint( w, &d ); } );

	function( "b3DestroyJoint(jointId, wakeAttached)", &b3DestroyJoint );
	function( "b3Joint_IsValid(id)", &b3Joint_IsValid );
	function( "b3Joint_GetType(jointId)", &b3Joint_GetType );
	function( "b3Joint_GetBodyA(jointId)", &b3Joint_GetBodyA );
	function( "b3Joint_GetBodyB(jointId)", &b3Joint_GetBodyB );
	function( "b3Joint_GetWorld(jointId)", &b3Joint_GetWorld );
	function( "b3Joint_SetLocalFrameA(jointId, localFrame)", &b3Joint_SetLocalFrameA );
	out_function( "b3Joint_GetLocalFrameA(outPosition, outRotation, jointId)", out_desc::Vec3, out_desc::Quat, out_desc::Pass,
		+[]( uintptr_t outPos, uintptr_t outRot, b3JointId jointId ) { b3Transform t = b3Joint_GetLocalFrameA( jointId ); writeVec3( outPos, t.p ); writeQuat( outRot, t.q ); } );
	function( "b3Joint_SetLocalFrameB(jointId, localFrame)", &b3Joint_SetLocalFrameB );
	out_function( "b3Joint_GetLocalFrameB(outPosition, outRotation, jointId)", out_desc::Vec3, out_desc::Quat, out_desc::Pass,
		+[]( uintptr_t outPos, uintptr_t outRot, b3JointId jointId ) { b3Transform t = b3Joint_GetLocalFrameB( jointId ); writeVec3( outPos, t.p ); writeQuat( outRot, t.q ); } );
	function( "b3Joint_SetCollideConnected(jointId, shouldCollide)", &b3Joint_SetCollideConnected );
	function( "b3Joint_GetCollideConnected(jointId)", &b3Joint_GetCollideConnected );
	function( "b3Joint_WakeBodies(jointId)", &b3Joint_WakeBodies );
	out_function( "b3Joint_GetConstraintForce(out, jointId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3JointId jointId ) { writeVec3( out, b3Joint_GetConstraintForce( jointId ) ); } );
	out_function( "b3Joint_GetConstraintTorque(out, jointId)", out_desc::Vec3, out_desc::Pass, +[]( uintptr_t out, b3JointId jointId ) { writeVec3( out, b3Joint_GetConstraintTorque( jointId ) ); } );
	function( "b3Joint_GetLinearSeparation(jointId)", &b3Joint_GetLinearSeparation );
	function( "b3Joint_GetAngularSeparation(jointId)", &b3Joint_GetAngularSeparation );
	function( "b3Joint_SetConstraintTuning(jointId, hertz, dampingRatio)", &b3Joint_SetConstraintTuning );
	function( "b3Joint_SetForceThreshold(jointId, threshold)", &b3Joint_SetForceThreshold );
	function( "b3Joint_GetForceThreshold(jointId)", &b3Joint_GetForceThreshold );
	function( "b3Joint_SetTorqueThreshold(jointId, threshold)", &b3Joint_SetTorqueThreshold );
	function( "b3Joint_GetTorqueThreshold(jointId)", &b3Joint_GetTorqueThreshold );

	// parallel joint
	function( "b3ParallelJoint_SetSpringHertz(jointId, hertz)", &b3ParallelJoint_SetSpringHertz );
	function( "b3ParallelJoint_SetSpringDampingRatio(jointId, dampingRatio)", &b3ParallelJoint_SetSpringDampingRatio );
	function( "b3ParallelJoint_GetSpringHertz(jointId)", &b3ParallelJoint_GetSpringHertz );
	function( "b3ParallelJoint_GetSpringDampingRatio(jointId)", &b3ParallelJoint_GetSpringDampingRatio );
	function( "b3ParallelJoint_SetMaxTorque(jointId, force)", &b3ParallelJoint_SetMaxTorque );
	function( "b3ParallelJoint_GetMaxTorque(jointId)", &b3ParallelJoint_GetMaxTorque );

	// distance joint
	function( "b3DistanceJoint_SetLength(jointId, length)", &b3DistanceJoint_SetLength );
	function( "b3DistanceJoint_GetLength(jointId)", &b3DistanceJoint_GetLength );
	function( "b3DistanceJoint_EnableSpring(jointId, enableSpring)", &b3DistanceJoint_EnableSpring );
	function( "b3DistanceJoint_IsSpringEnabled(jointId)", &b3DistanceJoint_IsSpringEnabled );
	function( "b3DistanceJoint_SetSpringForceRange(jointId, lowerForce, upperForce)", &b3DistanceJoint_SetSpringForceRange );
	function( "b3DistanceJoint_GetSpringForceRange(jointId)", +[]( b3JointId jointId )
	{
		float lowerForce = 0.0f, upperForce = 0.0f;
		b3DistanceJoint_GetSpringForceRange( jointId, &lowerForce, &upperForce );
		val out = val::object();
		out.set( "lowerForce", lowerForce );
		out.set( "upperForce", upperForce );
		return out;
	} );
	function( "b3DistanceJoint_SetSpringHertz(jointId, hertz)", &b3DistanceJoint_SetSpringHertz );
	function( "b3DistanceJoint_SetSpringDampingRatio(jointId, dampingRatio)", &b3DistanceJoint_SetSpringDampingRatio );
	function( "b3DistanceJoint_GetSpringHertz(jointId)", &b3DistanceJoint_GetSpringHertz );
	function( "b3DistanceJoint_GetSpringDampingRatio(jointId)", &b3DistanceJoint_GetSpringDampingRatio );
	function( "b3DistanceJoint_SetSpringStiffness(jointId, stiffness, damping)", &b3DistanceJoint_SetSpringStiffness );
	function( "b3DistanceJoint_GetSpringStiffness(jointId)", &b3DistanceJoint_GetSpringStiffness );
	function( "b3DistanceJoint_GetSpringDamping(jointId)", &b3DistanceJoint_GetSpringDamping );
	function( "b3DistanceJoint_EnableLimit(jointId, enableLimit)", &b3DistanceJoint_EnableLimit );
	function( "b3DistanceJoint_IsLimitEnabled(jointId)", &b3DistanceJoint_IsLimitEnabled );
	function( "b3DistanceJoint_SetLengthRange(jointId, minLength, maxLength)", &b3DistanceJoint_SetLengthRange );
	function( "b3DistanceJoint_GetMinLength(jointId)", &b3DistanceJoint_GetMinLength );
	function( "b3DistanceJoint_GetMaxLength(jointId)", &b3DistanceJoint_GetMaxLength );
	function( "b3DistanceJoint_GetCurrentLength(jointId)", &b3DistanceJoint_GetCurrentLength );
	function( "b3DistanceJoint_EnableMotor(jointId, enableMotor)", &b3DistanceJoint_EnableMotor );
	function( "b3DistanceJoint_IsMotorEnabled(jointId)", &b3DistanceJoint_IsMotorEnabled );
	function( "b3DistanceJoint_SetMotorSpeed(jointId, motorSpeed)", &b3DistanceJoint_SetMotorSpeed );
	function( "b3DistanceJoint_GetMotorSpeed(jointId)", &b3DistanceJoint_GetMotorSpeed );
	function( "b3DistanceJoint_SetMaxMotorForce(jointId, force)", &b3DistanceJoint_SetMaxMotorForce );
	function( "b3DistanceJoint_GetMaxMotorForce(jointId)", &b3DistanceJoint_GetMaxMotorForce );
	function( "b3DistanceJoint_GetMotorForce(jointId)", &b3DistanceJoint_GetMotorForce );

	// motor joint
	function( "b3MotorJoint_SetLinearVelocity(jointId, velocity)", &b3MotorJoint_SetLinearVelocity );
	function( "b3MotorJoint_GetLinearVelocity(jointId)", &b3MotorJoint_GetLinearVelocity );
	function( "b3MotorJoint_SetAngularVelocity(jointId, velocity)", &b3MotorJoint_SetAngularVelocity );
	function( "b3MotorJoint_GetAngularVelocity(jointId)", &b3MotorJoint_GetAngularVelocity );
	function( "b3MotorJoint_SetMaxVelocityForce(jointId, maxForce)", &b3MotorJoint_SetMaxVelocityForce );
	function( "b3MotorJoint_GetMaxVelocityForce(jointId)", &b3MotorJoint_GetMaxVelocityForce );
	function( "b3MotorJoint_SetMaxVelocityTorque(jointId, maxTorque)", &b3MotorJoint_SetMaxVelocityTorque );
	function( "b3MotorJoint_GetMaxVelocityTorque(jointId)", &b3MotorJoint_GetMaxVelocityTorque );
	function( "b3MotorJoint_SetLinearHertz(jointId, hertz)", &b3MotorJoint_SetLinearHertz );
	function( "b3MotorJoint_GetLinearHertz(jointId)", &b3MotorJoint_GetLinearHertz );
	function( "b3MotorJoint_SetLinearDampingRatio(jointId, damping)", &b3MotorJoint_SetLinearDampingRatio );
	function( "b3MotorJoint_GetLinearDampingRatio(jointId)", &b3MotorJoint_GetLinearDampingRatio );
	function( "b3MotorJoint_SetAngularHertz(jointId, hertz)", &b3MotorJoint_SetAngularHertz );
	function( "b3MotorJoint_GetAngularHertz(jointId)", &b3MotorJoint_GetAngularHertz );
	function( "b3MotorJoint_SetAngularDampingRatio(jointId, damping)", &b3MotorJoint_SetAngularDampingRatio );
	function( "b3MotorJoint_GetAngularDampingRatio(jointId)", &b3MotorJoint_GetAngularDampingRatio );
	function( "b3MotorJoint_SetMaxSpringForce(jointId, maxForce)", &b3MotorJoint_SetMaxSpringForce );
	function( "b3MotorJoint_GetMaxSpringForce(jointId)", &b3MotorJoint_GetMaxSpringForce );
	function( "b3MotorJoint_SetMaxSpringTorque(jointId, maxTorque)", &b3MotorJoint_SetMaxSpringTorque );
	function( "b3MotorJoint_GetMaxSpringTorque(jointId)", &b3MotorJoint_GetMaxSpringTorque );

	// prismatic joint
	function( "b3PrismaticJoint_EnableSpring(jointId, enableSpring)", &b3PrismaticJoint_EnableSpring );
	function( "b3PrismaticJoint_IsSpringEnabled(jointId)", &b3PrismaticJoint_IsSpringEnabled );
	function( "b3PrismaticJoint_SetSpringHertz(jointId, hertz)", &b3PrismaticJoint_SetSpringHertz );
	function( "b3PrismaticJoint_GetSpringHertz(jointId)", &b3PrismaticJoint_GetSpringHertz );
	function( "b3PrismaticJoint_SetSpringDampingRatio(jointId, dampingRatio)", &b3PrismaticJoint_SetSpringDampingRatio );
	function( "b3PrismaticJoint_GetSpringDampingRatio(jointId)", &b3PrismaticJoint_GetSpringDampingRatio );
	function( "b3PrismaticJoint_SetTargetTranslation(jointId, targetTranslation)", &b3PrismaticJoint_SetTargetTranslation );
	function( "b3PrismaticJoint_GetTargetTranslation(jointId)", &b3PrismaticJoint_GetTargetTranslation );
	function( "b3PrismaticJoint_EnableLimit(jointId, enableLimit)", &b3PrismaticJoint_EnableLimit );
	function( "b3PrismaticJoint_IsLimitEnabled(jointId)", &b3PrismaticJoint_IsLimitEnabled );
	function( "b3PrismaticJoint_GetLowerLimit(jointId)", &b3PrismaticJoint_GetLowerLimit );
	function( "b3PrismaticJoint_GetUpperLimit(jointId)", &b3PrismaticJoint_GetUpperLimit );
	function( "b3PrismaticJoint_SetLimits(jointId, lower, upper)", &b3PrismaticJoint_SetLimits );
	function( "b3PrismaticJoint_EnableMotor(jointId, enableMotor)", &b3PrismaticJoint_EnableMotor );
	function( "b3PrismaticJoint_IsMotorEnabled(jointId)", &b3PrismaticJoint_IsMotorEnabled );
	function( "b3PrismaticJoint_SetMotorSpeed(jointId, motorSpeed)", &b3PrismaticJoint_SetMotorSpeed );
	function( "b3PrismaticJoint_GetMotorSpeed(jointId)", &b3PrismaticJoint_GetMotorSpeed );
	function( "b3PrismaticJoint_SetMaxMotorForce(jointId, force)", &b3PrismaticJoint_SetMaxMotorForce );
	function( "b3PrismaticJoint_GetMaxMotorForce(jointId)", &b3PrismaticJoint_GetMaxMotorForce );
	function( "b3PrismaticJoint_GetMotorForce(jointId)", &b3PrismaticJoint_GetMotorForce );
	function( "b3PrismaticJoint_GetTranslation(jointId)", &b3PrismaticJoint_GetTranslation );
	function( "b3PrismaticJoint_GetSpeed(jointId)", &b3PrismaticJoint_GetSpeed );

	// cylindrical joint
	function( "b3CylindricalJoint_EnableSpring(jointId, enableSpring)", &b3CylindricalJoint_EnableSpring );
	function( "b3CylindricalJoint_IsSpringEnabled(jointId)", &b3CylindricalJoint_IsSpringEnabled );
	function( "b3CylindricalJoint_SetSpringHertz(jointId, hertz)", &b3CylindricalJoint_SetSpringHertz );
	function( "b3CylindricalJoint_GetSpringHertz(jointId)", &b3CylindricalJoint_GetSpringHertz );
	function( "b3CylindricalJoint_SetSpringDampingRatio(jointId, dampingRatio)", &b3CylindricalJoint_SetSpringDampingRatio );
	function( "b3CylindricalJoint_GetSpringDampingRatio(jointId)", &b3CylindricalJoint_GetSpringDampingRatio );
	function( "b3CylindricalJoint_SetTargetTranslation(jointId, targetTranslation)", &b3CylindricalJoint_SetTargetTranslation );
	function( "b3CylindricalJoint_GetTargetTranslation(jointId)", &b3CylindricalJoint_GetTargetTranslation );
	function( "b3CylindricalJoint_EnableLimit(jointId, enableLimit)", &b3CylindricalJoint_EnableLimit );
	function( "b3CylindricalJoint_IsLimitEnabled(jointId)", &b3CylindricalJoint_IsLimitEnabled );
	function( "b3CylindricalJoint_GetLowerLimit(jointId)", &b3CylindricalJoint_GetLowerLimit );
	function( "b3CylindricalJoint_GetUpperLimit(jointId)", &b3CylindricalJoint_GetUpperLimit );
	function( "b3CylindricalJoint_SetLimits(jointId, lower, upper)", &b3CylindricalJoint_SetLimits );
	function( "b3CylindricalJoint_EnableMotor(jointId, enableMotor)", &b3CylindricalJoint_EnableMotor );
	function( "b3CylindricalJoint_IsMotorEnabled(jointId)", &b3CylindricalJoint_IsMotorEnabled );
	function( "b3CylindricalJoint_SetMotorSpeed(jointId, motorSpeed)", &b3CylindricalJoint_SetMotorSpeed );
	function( "b3CylindricalJoint_GetMotorSpeed(jointId)", &b3CylindricalJoint_GetMotorSpeed );
	function( "b3CylindricalJoint_SetMaxMotorForce(jointId, force)", &b3CylindricalJoint_SetMaxMotorForce );
	function( "b3CylindricalJoint_GetMaxMotorForce(jointId)", &b3CylindricalJoint_GetMaxMotorForce );
	function( "b3CylindricalJoint_GetMotorForce(jointId)", &b3CylindricalJoint_GetMotorForce );
	function( "b3CylindricalJoint_EnableAngularSpring(jointId, enableSpring)", &b3CylindricalJoint_EnableAngularSpring );
	function( "b3CylindricalJoint_IsAngularSpringEnabled(jointId)", &b3CylindricalJoint_IsAngularSpringEnabled );
	function( "b3CylindricalJoint_SetAngularSpringHertz(jointId, hertz)", &b3CylindricalJoint_SetAngularSpringHertz );
	function( "b3CylindricalJoint_GetAngularSpringHertz(jointId)", &b3CylindricalJoint_GetAngularSpringHertz );
	function( "b3CylindricalJoint_SetAngularSpringDampingRatio(jointId, dampingRatio)", &b3CylindricalJoint_SetAngularSpringDampingRatio );
	function( "b3CylindricalJoint_GetAngularSpringDampingRatio(jointId)", &b3CylindricalJoint_GetAngularSpringDampingRatio );
	function( "b3CylindricalJoint_SetTargetAngle(jointId, targetAngle)", &b3CylindricalJoint_SetTargetAngle );
	function( "b3CylindricalJoint_GetTargetAngle(jointId)", &b3CylindricalJoint_GetTargetAngle );
	function( "b3CylindricalJoint_EnableAngularLimit(jointId, enableLimit)", &b3CylindricalJoint_EnableAngularLimit );
	function( "b3CylindricalJoint_IsAngularLimitEnabled(jointId)", &b3CylindricalJoint_IsAngularLimitEnabled );
	function( "b3CylindricalJoint_GetLowerAngle(jointId)", &b3CylindricalJoint_GetLowerAngle );
	function( "b3CylindricalJoint_GetUpperAngle(jointId)", &b3CylindricalJoint_GetUpperAngle );
	function( "b3CylindricalJoint_SetAngularLimits(jointId, lower, upper)", &b3CylindricalJoint_SetAngularLimits );
	function( "b3CylindricalJoint_EnableAngularMotor(jointId, enableMotor)", &b3CylindricalJoint_EnableAngularMotor );
	function( "b3CylindricalJoint_IsAngularMotorEnabled(jointId)", &b3CylindricalJoint_IsAngularMotorEnabled );
	function( "b3CylindricalJoint_SetAngularMotorSpeed(jointId, motorSpeed)", &b3CylindricalJoint_SetAngularMotorSpeed );
	function( "b3CylindricalJoint_GetAngularMotorSpeed(jointId)", &b3CylindricalJoint_GetAngularMotorSpeed );
	function( "b3CylindricalJoint_SetMaxMotorTorque(jointId, torque)", &b3CylindricalJoint_SetMaxMotorTorque );
	function( "b3CylindricalJoint_GetMaxMotorTorque(jointId)", &b3CylindricalJoint_GetMaxMotorTorque );
	function( "b3CylindricalJoint_GetMotorTorque(jointId)", &b3CylindricalJoint_GetMotorTorque );
	function( "b3CylindricalJoint_GetTranslation(jointId)", &b3CylindricalJoint_GetTranslation );
	function( "b3CylindricalJoint_GetSpeed(jointId)", &b3CylindricalJoint_GetSpeed );
	function( "b3CylindricalJoint_GetAngle(jointId)", &b3CylindricalJoint_GetAngle );
	function( "b3CylindricalJoint_GetAngularSpeed(jointId)", &b3CylindricalJoint_GetAngularSpeed );

	// revolute joint
	function( "b3RevoluteJoint_EnableSpring(jointId, enableSpring)", &b3RevoluteJoint_EnableSpring );
	function( "b3RevoluteJoint_IsSpringEnabled(jointId)", &b3RevoluteJoint_IsSpringEnabled );
	function( "b3RevoluteJoint_SetSpringHertz(jointId, hertz)", &b3RevoluteJoint_SetSpringHertz );
	function( "b3RevoluteJoint_GetSpringHertz(jointId)", &b3RevoluteJoint_GetSpringHertz );
	function( "b3RevoluteJoint_SetSpringDampingRatio(jointId, dampingRatio)", &b3RevoluteJoint_SetSpringDampingRatio );
	function( "b3RevoluteJoint_GetSpringDampingRatio(jointId)", &b3RevoluteJoint_GetSpringDampingRatio );
	function( "b3RevoluteJoint_SetTargetAngle(jointId, targetRadians)", &b3RevoluteJoint_SetTargetAngle );
	function( "b3RevoluteJoint_GetTargetAngle(jointId)", &b3RevoluteJoint_GetTargetAngle );
	function( "b3RevoluteJoint_GetAngle(jointId)", &b3RevoluteJoint_GetAngle );
	function( "b3RevoluteJoint_EnableLimit(jointId, enableLimit)", &b3RevoluteJoint_EnableLimit );
	function( "b3RevoluteJoint_IsLimitEnabled(jointId)", &b3RevoluteJoint_IsLimitEnabled );
	function( "b3RevoluteJoint_GetLowerLimit(jointId)", &b3RevoluteJoint_GetLowerLimit );
	function( "b3RevoluteJoint_GetUpperLimit(jointId)", &b3RevoluteJoint_GetUpperLimit );
	function( "b3RevoluteJoint_SetLimits(jointId, lowerLimitRadians, upperLimitRadians)", &b3RevoluteJoint_SetLimits );
	function( "b3RevoluteJoint_EnableMotor(jointId, enableMotor)", &b3RevoluteJoint_EnableMotor );
	function( "b3RevoluteJoint_IsMotorEnabled(jointId)", &b3RevoluteJoint_IsMotorEnabled );
	function( "b3RevoluteJoint_SetMotorSpeed(jointId, motorSpeed)", &b3RevoluteJoint_SetMotorSpeed );
	function( "b3RevoluteJoint_GetMotorSpeed(jointId)", &b3RevoluteJoint_GetMotorSpeed );
	function( "b3RevoluteJoint_GetMotorTorque(jointId)", &b3RevoluteJoint_GetMotorTorque );
	function( "b3RevoluteJoint_SetMaxMotorTorque(jointId, torque)", &b3RevoluteJoint_SetMaxMotorTorque );
	function( "b3RevoluteJoint_GetMaxMotorTorque(jointId)", &b3RevoluteJoint_GetMaxMotorTorque );

	// spherical joint
	function( "b3SphericalJoint_EnableConeLimit(jointId, enableConeLimit)", &b3SphericalJoint_EnableConeLimit );
	function( "b3SphericalJoint_IsConeLimitEnabled(jointId)", &b3SphericalJoint_IsConeLimitEnabled );
	function( "b3SphericalJoint_GetConeLimit(jointId)", &b3SphericalJoint_GetConeLimit );
	function( "b3SphericalJoint_SetConeLimit(jointId, coneAngle)", &b3SphericalJoint_SetConeLimit );
	function( "b3SphericalJoint_GetConeAngle(jointId)", &b3SphericalJoint_GetConeAngle );
	function( "b3SphericalJoint_EnableTwistLimit(jointId, enableTwistLimit)", &b3SphericalJoint_EnableTwistLimit );
	function( "b3SphericalJoint_IsTwistLimitEnabled(jointId)", &b3SphericalJoint_IsTwistLimitEnabled );
	function( "b3SphericalJoint_GetLowerTwistLimit(jointId)", &b3SphericalJoint_GetLowerTwistLimit );
	function( "b3SphericalJoint_GetUpperTwistLimit(jointId)", &b3SphericalJoint_GetUpperTwistLimit );
	function( "b3SphericalJoint_SetTwistLimits(jointId, lowerLimitRadians, upperLimitRadians)", &b3SphericalJoint_SetTwistLimits );
	function( "b3SphericalJoint_GetTwistAngle(jointId)", &b3SphericalJoint_GetTwistAngle );
	function( "b3SphericalJoint_EnableSpring(jointId, enableSpring)", &b3SphericalJoint_EnableSpring );
	function( "b3SphericalJoint_IsSpringEnabled(jointId)", &b3SphericalJoint_IsSpringEnabled );
	function( "b3SphericalJoint_SetSpringHertz(jointId, hertz)", &b3SphericalJoint_SetSpringHertz );
	function( "b3SphericalJoint_GetSpringHertz(jointId)", &b3SphericalJoint_GetSpringHertz );
	function( "b3SphericalJoint_SetSpringDampingRatio(jointId, dampingRatio)", &b3SphericalJoint_SetSpringDampingRatio );
	function( "b3SphericalJoint_GetSpringDampingRatio(jointId)", &b3SphericalJoint_GetSpringDampingRatio );
	function( "b3SphericalJoint_SetTargetRotation(jointId, targetRotation)", &b3SphericalJoint_SetTargetRotation );
	function( "b3SphericalJoint_GetTargetRotation(jointId)", &b3SphericalJoint_GetTargetRotation );
	function( "b3SphericalJoint_EnableMotor(jointId, enableMotor)", &b3SphericalJoint_EnableMotor );
	function( "b3SphericalJoint_IsMotorEnabled(jointId)", &b3SphericalJoint_IsMotorEnabled );
	function( "b3SphericalJoint_SetMotorVelocity(jointId, velocity)", &b3SphericalJoint_SetMotorVelocity );
	function( "b3SphericalJoint_GetMotorVelocity(jointId)", &b3SphericalJoint_GetMotorVelocity );
	function( "b3SphericalJoint_GetMotorTorque(jointId)", &b3SphericalJoint_GetMotorTorque );
	function( "b3SphericalJoint_SetMaxMotorTorque(jointId, torque)", &b3SphericalJoint_SetMaxMotorTorque );
	function( "b3SphericalJoint_GetMaxMotorTorque(jointId)", &b3SphericalJoint_GetMaxMotorTorque );

	// weld joint
	function( "b3WeldJoint_SetLinearHertz(jointId, hertz)", &b3WeldJoint_SetLinearHertz );
	function( "b3WeldJoint_GetLinearHertz(jointId)", &b3WeldJoint_GetLinearHertz );
	function( "b3WeldJoint_SetLinearDampingRatio(jointId, dampingRatio)", &b3WeldJoint_SetLinearDampingRatio );
	function( "b3WeldJoint_GetLinearDampingRatio(jointId)", &b3WeldJoint_GetLinearDampingRatio );
	function( "b3WeldJoint_SetAngularHertz(jointId, hertz)", &b3WeldJoint_SetAngularHertz );
	function( "b3WeldJoint_GetAngularHertz(jointId)", &b3WeldJoint_GetAngularHertz );
	function( "b3WeldJoint_SetAngularDampingRatio(jointId, dampingRatio)", &b3WeldJoint_SetAngularDampingRatio );
	function( "b3WeldJoint_GetAngularDampingRatio(jointId)", &b3WeldJoint_GetAngularDampingRatio );

	// wheel joint
	function( "b3WheelJoint_EnableSuspension(jointId, flag)", &b3WheelJoint_EnableSuspension );
	function( "b3WheelJoint_IsSuspensionEnabled(jointId)", &b3WheelJoint_IsSuspensionEnabled );
	function( "b3WheelJoint_SetSuspensionHertz(jointId, hertz)", &b3WheelJoint_SetSuspensionHertz );
	function( "b3WheelJoint_GetSuspensionHertz(jointId)", &b3WheelJoint_GetSuspensionHertz );
	function( "b3WheelJoint_SetSuspensionDampingRatio(jointId, dampingRatio)", &b3WheelJoint_SetSuspensionDampingRatio );
	function( "b3WheelJoint_GetSuspensionDampingRatio(jointId)", &b3WheelJoint_GetSuspensionDampingRatio );
	function( "b3WheelJoint_EnableSuspensionLimit(jointId, flag)", &b3WheelJoint_EnableSuspensionLimit );
	function( "b3WheelJoint_IsSuspensionLimitEnabled(jointId)", &b3WheelJoint_IsSuspensionLimitEnabled );
	function( "b3WheelJoint_GetLowerSuspensionLimit(jointId)", &b3WheelJoint_GetLowerSuspensionLimit );
	function( "b3WheelJoint_GetUpperSuspensionLimit(jointId)", &b3WheelJoint_GetUpperSuspensionLimit );
	function( "b3WheelJoint_SetSuspensionLimits(jointId, lower, upper)", &b3WheelJoint_SetSuspensionLimits );
	function( "b3WheelJoint_EnableSpinMotor(jointId, flag)", &b3WheelJoint_EnableSpinMotor );
	function( "b3WheelJoint_IsSpinMotorEnabled(jointId)", &b3WheelJoint_IsSpinMotorEnabled );
	function( "b3WheelJoint_SetSpinMotorSpeed(jointId, motorSpeed)", &b3WheelJoint_SetSpinMotorSpeed );
	function( "b3WheelJoint_GetSpinMotorSpeed(jointId)", &b3WheelJoint_GetSpinMotorSpeed );
	function( "b3WheelJoint_SetMaxSpinTorque(jointId, torque)", &b3WheelJoint_SetMaxSpinTorque );
	function( "b3WheelJoint_GetMaxSpinTorque(jointId)", &b3WheelJoint_GetMaxSpinTorque );
	function( "b3WheelJoint_GetSpinSpeed(jointId)", &b3WheelJoint_GetSpinSpeed );
	function( "b3WheelJoint_GetSpinTorque(jointId)", &b3WheelJoint_GetSpinTorque );
	function( "b3WheelJoint_EnableSteering(jointId, flag)", &b3WheelJoint_EnableSteering );
	function( "b3WheelJoint_IsSteeringEnabled(jointId)", &b3WheelJoint_IsSteeringEnabled );
	function( "b3WheelJoint_SetSteeringHertz(jointId, hertz)", &b3WheelJoint_SetSteeringHertz );
	function( "b3WheelJoint_GetSteeringHertz(jointId)", &b3WheelJoint_GetSteeringHertz );
	function( "b3WheelJoint_SetSteeringDampingRatio(jointId, dampingRatio)", &b3WheelJoint_SetSteeringDampingRatio );
	function( "b3WheelJoint_GetSteeringDampingRatio(jointId)", &b3WheelJoint_GetSteeringDampingRatio );
	function( "b3WheelJoint_SetMaxSteeringTorque(jointId, torque)", &b3WheelJoint_SetMaxSteeringTorque );
	function( "b3WheelJoint_GetMaxSteeringTorque(jointId)", &b3WheelJoint_GetMaxSteeringTorque );
	function( "b3WheelJoint_EnableSteeringLimit(jointId, flag)", &b3WheelJoint_EnableSteeringLimit );
	function( "b3WheelJoint_IsSteeringLimitEnabled(jointId)", &b3WheelJoint_IsSteeringLimitEnabled );
	function( "b3WheelJoint_GetLowerSteeringLimit(jointId)", &b3WheelJoint_GetLowerSteeringLimit );
	function( "b3WheelJoint_GetUpperSteeringLimit(jointId)", &b3WheelJoint_GetUpperSteeringLimit );
	function( "b3WheelJoint_SetSteeringLimits(jointId, lower, upper)", &b3WheelJoint_SetSteeringLimits );
	function( "b3WheelJoint_SetTargetSteeringAngle(jointId, targetAngle)", &b3WheelJoint_SetTargetSteeringAngle );
	function( "b3WheelJoint_GetTargetSteeringAngle(jointId)", &b3WheelJoint_GetTargetSteeringAngle );
	function( "b3WheelJoint_GetSteeringAngle(jointId)", &b3WheelJoint_GetSteeringAngle );
	function( "b3WheelJoint_GetSteeringTorque(jointId)", &b3WheelJoint_GetSteeringTorque );
	value_object<b3Matrix3>( "b3Matrix3" )
		.field( "cx", &b3Matrix3::cx )
		.field( "cy", &b3Matrix3::cy )
		.field( "cz", &b3Matrix3::cz );

	value_object<b3MassData>( "b3MassData" )
		.field( "mass", &b3MassData::mass )
		.field( "center", &b3MassData::center )
		.field( "inertia", &b3MassData::inertia );

	value_object<b3QueryFilter>( "b3QueryFilter" )
		.field( "categoryBits", &b3QueryFilter::categoryBits )
		.field( "maskBits", &b3QueryFilter::maskBits )
		.field( "id", &b3QueryFilter::id );

	value_object<b3RayResult>( "b3RayResult" )
		.field( "shapeId", &b3RayResult::shapeId )
		.field( "point", &b3RayResult::point )
		.field( "normal", &b3RayResult::normal )
		.field( "userMaterialId", &b3RayResult::userMaterialId )
		.field( "fraction", &b3RayResult::fraction )
		.field( "triangleIndex", &b3RayResult::triangleIndex )
		.field( "childIndex", &b3RayResult::childIndex )
		.field( "nodeVisits", &b3RayResult::nodeVisits )
		.field( "leafVisits", &b3RayResult::leafVisits )
		.field( "hit", &b3RayResult::hit );

	value_object<b3WorldCastOutput>( "b3WorldCastOutput" )
		.field( "normal", &b3WorldCastOutput::normal )
		.field( "point", &b3WorldCastOutput::point )
		.field( "fraction", &b3WorldCastOutput::fraction )
		.field( "iterations", &b3WorldCastOutput::iterations )
		.field( "triangleIndex", &b3WorldCastOutput::triangleIndex )
		.field( "childIndex", &b3WorldCastOutput::childIndex )
		.field( "materialIndex", &b3WorldCastOutput::materialIndex )
		.field( "hit", &b3WorldCastOutput::hit );

	function( "b3DefaultQueryFilter()", &b3DefaultQueryFilter );

	function( "b3World_CastRayClosest(worldId, origin, translation, filter)", &b3World_CastRayClosest );
	function( "b3Body_GetMassData(bodyId)", &b3Body_GetMassData );
	function( "b3Body_SetMassData(bodyId, massData)", &b3Body_SetMassData );
	function( "b3Body_GetLocalRotationalInertia(bodyId)", &b3Body_GetLocalRotationalInertia );
	function( "b3Body_GetWorldInverseRotationalInertia(bodyId)", &b3Body_GetWorldInverseRotationalInertia );
	function( "b3Shape_ComputeMassData(shapeId)", &b3Shape_ComputeMassData );
	function( "b3Shape_RayCast(shapeId, origin, translation)", &b3Shape_RayCast );

	function( "b3World_OverlapAABB(worldId, aabb, filter, callback)", +[]( b3WorldId worldId, b3AABB aabb, b3QueryFilter filter, val cb )
	{
		b3World_OverlapAABB( worldId, aabb, filter,
			[]( b3ShapeId shapeId, void* ctx ) -> bool
			{
				val r = ( *static_cast<val*>( ctx ) )( shapeId );
				return r.isUndefined() ? true : r.as<bool>();
			},
			&cb );
	} );
	function( "b3World_CastRay(worldId, origin, translation, filter, callback)", +[]( b3WorldId worldId, b3Vec3 origin, b3Vec3 translation, b3QueryFilter filter, val cb )
	{
		b3World_CastRay( worldId, origin, translation, filter,
			[]( b3ShapeId shapeId, b3Pos point, b3Vec3 normal, float fraction, uint64_t, int, int, void* ctx ) -> float
			{
				val r = ( *static_cast<val*>( ctx ) )( shapeId, point, normal, fraction );
				return r.isUndefined() ? 1.0f : r.as<float>();
			},
			&cb );
	} );

	// void* userData fields omitted from event structs.
	value_object<b3BodyMoveEvent>( "b3BodyMoveEvent" )
		.field( "transform", &b3BodyMoveEvent::transform )
		.field( "bodyId", &b3BodyMoveEvent::bodyId )
		.field( "fellAsleep", &b3BodyMoveEvent::fellAsleep );

	value_object<b3SensorBeginTouchEvent>( "b3SensorBeginTouchEvent" )
		.field( "sensorShapeId", &b3SensorBeginTouchEvent::sensorShapeId )
		.field( "visitorShapeId", &b3SensorBeginTouchEvent::visitorShapeId );

	value_object<b3SensorEndTouchEvent>( "b3SensorEndTouchEvent" )
		.field( "sensorShapeId", &b3SensorEndTouchEvent::sensorShapeId )
		.field( "visitorShapeId", &b3SensorEndTouchEvent::visitorShapeId );

	value_object<b3ContactBeginTouchEvent>( "b3ContactBeginTouchEvent" )
		.field( "shapeIdA", &b3ContactBeginTouchEvent::shapeIdA )
		.field( "shapeIdB", &b3ContactBeginTouchEvent::shapeIdB )
		.field( "contactId", &b3ContactBeginTouchEvent::contactId );

	value_object<b3ContactEndTouchEvent>( "b3ContactEndTouchEvent" )
		.field( "shapeIdA", &b3ContactEndTouchEvent::shapeIdA )
		.field( "shapeIdB", &b3ContactEndTouchEvent::shapeIdB )
		.field( "contactId", &b3ContactEndTouchEvent::contactId );

	value_object<b3ContactHitEvent>( "b3ContactHitEvent" )
		.field( "shapeIdA", &b3ContactHitEvent::shapeIdA )
		.field( "shapeIdB", &b3ContactHitEvent::shapeIdB )
		.field( "contactId", &b3ContactHitEvent::contactId )
		.field( "point", &b3ContactHitEvent::point )
		.field( "normal", &b3ContactHitEvent::normal )
		.field( "approachSpeed", &b3ContactHitEvent::approachSpeed )
		.field( "userMaterialIdA", &b3ContactHitEvent::userMaterialIdA )
		.field( "userMaterialIdB", &b3ContactHitEvent::userMaterialIdB );

	value_object<b3JointEvent>( "b3JointEvent" )
		.field( "jointId", &b3JointEvent::jointId );

	// Per-step events: read through the reusable, wasm-backed EventsBuffer (see the
	// facade helpers createEventsBuffer / getEvents / getNum*Events / get*EventAt).
	// The old array-returning accessors are gone — materialising a JS object per
	// event every step scales terribly, and the buffer path is zero-alloc.
	class_<EventsBuffer>( "EventsBufferImpl" )
		.constructor<>()
		.function( "loadFrom", &EventsBuffer::loadFrom )
		.function( "contactBeginCount", &EventsBuffer::getContactBeginCount )
		.function( "contactEndCount", &EventsBuffer::getContactEndCount )
		.function( "contactHitCount", &EventsBuffer::getContactHitCount )
		.function( "bodyMoveCount", &EventsBuffer::getBodyMoveCount )
		.function( "sensorBeginCount", &EventsBuffer::getSensorBeginCount )
		.function( "sensorEndCount", &EventsBuffer::getSensorEndCount )
		.function( "jointCount", &EventsBuffer::getJointCount )
		.function( "contactBeginPtr", &EventsBuffer::contactBeginPtr )
		.function( "contactEndPtr", &EventsBuffer::contactEndPtr )
		.function( "contactHitI32Ptr", &EventsBuffer::contactHitI32Ptr )
		.function( "contactHitF64Ptr", &EventsBuffer::contactHitF64Ptr )
		.function( "bodyMoveI32Ptr", &EventsBuffer::bodyMoveI32Ptr )
		.function( "bodyMoveF64Ptr", &EventsBuffer::bodyMoveF64Ptr )
		.function( "sensorBeginPtr", &EventsBuffer::sensorBeginPtr )
		.function( "sensorEndPtr", &EventsBuffer::sensorEndPtr )
		.function( "jointPtr", &EventsBuffer::jointPtr );

	// NOTE: box3d's inline vector/quaternion/AABB math (b3Cross, b3RotateVector,
	// b3MakeQuatFromAxisAngle, b3AABB_Union, …) is intentionally NOT bound — a quick
	// math op should never cross the wasm boundary. Do it in JS (gl-matrix / mathcat).

	// b3DynamicTree owns heap memory — opaque handle, never copied to JS by value. Category/mask/userData as 32-bit numbers.
	class_<b3DynamicTree>( "b3DynamicTree" );

	function( "b3CreateDynamicTree(proxyCapacity)", +[]( int proxyCapacity ) -> b3DynamicTree*
	{
		b3DynamicTree* tree = new b3DynamicTree();
		*tree = b3DynamicTree_Create( proxyCapacity );
		return tree;
	}, allow_raw_pointers() );

	function( "b3DestroyDynamicTree(tree)", +[]( b3DynamicTree* tree )
	{
		b3DynamicTree_Destroy( tree );
		delete tree;
	}, allow_raw_pointers() );

	function( "b3DynamicTree_CreateProxy(tree, aabb, categoryBits, userData)", +[]( b3DynamicTree* tree, b3AABB aabb, unsigned categoryBits, unsigned userData ) -> int
	{
		return b3DynamicTree_CreateProxy( tree, aabb, (uint64_t)categoryBits, (uint64_t)userData );
	}, allow_raw_pointers() );

	function( "b3DynamicTree_DestroyProxy(tree, proxyId)", +[]( b3DynamicTree* tree, int proxyId )
	{
		b3DynamicTree_DestroyProxy( tree, proxyId );
	}, allow_raw_pointers() );

	function( "b3DynamicTree_MoveProxy(tree, proxyId, aabb)", +[]( b3DynamicTree* tree, int proxyId, b3AABB aabb )
	{
		b3DynamicTree_MoveProxy( tree, proxyId, aabb );
	}, allow_raw_pointers() );

	function( "b3DynamicTree_EnlargeProxy(tree, proxyId, aabb)", +[]( b3DynamicTree* tree, int proxyId, b3AABB aabb )
	{
		b3DynamicTree_EnlargeProxy( tree, proxyId, aabb );
	}, allow_raw_pointers() );

	function( "b3DynamicTree_Query(tree, aabb, maskBits, callback)", +[]( b3DynamicTree* tree, b3AABB aabb, unsigned maskBits, val cb ) -> b3TreeStats
	{
		return b3DynamicTree_Query( tree, aabb, (uint64_t)maskBits, false,
			[]( int proxyId, uint64_t userData, void* ctx ) -> bool
			{
				val r = ( *static_cast<val*>( ctx ) )( proxyId, (unsigned)userData );
				return r.isUndefined() ? true : r.as<bool>();
			},
			&cb );
	}, allow_raw_pointers() );

	function( "b3DynamicTree_RayCast(tree, origin, translation, maxFraction, maskBits, callback)", +[]( b3DynamicTree* tree, b3Vec3 origin, b3Vec3 translation, float maxFraction, unsigned maskBits, val cb ) -> b3TreeStats
	{
		b3RayCastInput input{ origin, translation, maxFraction };
		return b3DynamicTree_RayCast( tree, &input, (uint64_t)maskBits, false,
			[]( const b3RayCastInput*, int proxyId, uint64_t userData, void* ctx ) -> float
			{
				val r = ( *static_cast<val*>( ctx ) )( proxyId, (unsigned)userData );
				return r.isUndefined() ? 1.0f : r.as<float>();
			},
			&cb );
	}, allow_raw_pointers() );

	function( "b3DynamicTree_Rebuild(tree, fullBuild)", +[]( b3DynamicTree* tree, bool fullBuild ) -> int
	{
		return b3DynamicTree_Rebuild( tree, fullBuild );
	}, allow_raw_pointers() );

	function( "b3DynamicTree_GetHeight(tree)", +[]( b3DynamicTree* tree ) -> int { return b3DynamicTree_GetHeight( tree ); }, allow_raw_pointers() );
	function( "b3DynamicTree_GetAreaRatio(tree)", +[]( b3DynamicTree* tree ) -> float { return b3DynamicTree_GetAreaRatio( tree ); }, allow_raw_pointers() );
	function( "b3DynamicTree_GetProxyCount(tree)", +[]( b3DynamicTree* tree ) -> int { return b3DynamicTree_GetProxyCount( tree ); }, allow_raw_pointers() );
	function( "b3DynamicTree_GetRootBounds(tree)", +[]( b3DynamicTree* tree ) -> b3AABB { return b3DynamicTree_GetRootBounds( tree ); }, allow_raw_pointers() );
	function( "b3DynamicTree_GetByteCount(tree)", +[]( b3DynamicTree* tree ) -> int { return b3DynamicTree_GetByteCount( tree ); }, allow_raw_pointers() );
	function( "b3DynamicTree_Validate(tree)", +[]( b3DynamicTree* tree ) { b3DynamicTree_Validate( tree ); }, allow_raw_pointers() );
	function( "b3DynamicTree_QueryClosest(tree, point, maskBits, callback)", +[]( b3DynamicTree* tree, b3Vec3 point, unsigned maskBits, val cb ) -> b3TreeStats
	{
		float minDistanceSqr = 3.4e38f;
		return b3DynamicTree_QueryClosest( tree, point, (uint64_t)maskBits, false,
			[]( float distanceSqrMin, int proxyId, uint64_t userData, void* ctx ) -> float
			{
				val r = ( *static_cast<val*>( ctx ) )( distanceSqrMin, proxyId, (unsigned)userData );
				return r.isUndefined() ? distanceSqrMin : r.as<float>();
			},
			&cb, &minDistanceSqr );
	}, allow_raw_pointers() );

	value_object<b3TreeStats>( "b3TreeStats" )
		.field( "nodeVisits", &b3TreeStats::nodeVisits )
		.field( "leafVisits", &b3TreeStats::leafVisits );

	// b3Recording / b3RecPlayer are opaque types — passed as uintptr_t handles. File I/O omitted (FILESYSTEM=0).
	function( "b3CreateRecording(byteCapacity)", +[]( int byteCapacity ) -> uintptr_t
	{ return reinterpret_cast<uintptr_t>( b3CreateRecording( byteCapacity ) ); } );
	function( "b3DestroyRecording(recording)", +[]( uintptr_t rec )
	{ b3DestroyRecording( reinterpret_cast<b3Recording*>( rec ) ); } );
	function( "b3World_StartRecording(worldId, recording)", +[]( b3WorldId worldId, uintptr_t rec )
	{ b3World_StartRecording( worldId, reinterpret_cast<b3Recording*>( rec ) ); } );
	function( "b3World_StopRecording(worldId)", &b3World_StopRecording );
	function( "b3Recording_GetSize(recording)", +[]( uintptr_t rec )
	{ return b3Recording_GetSize( reinterpret_cast<b3Recording*>( rec ) ); } );

	// Build a player straight from a recording (avoids marshalling the byte buffer).
	function( "b3RecPlayer_CreateFromRecording(recording, workerCount)", +[]( uintptr_t rec, int workerCount ) -> uintptr_t
	{
		b3Recording* r = reinterpret_cast<b3Recording*>( rec );
		return reinterpret_cast<uintptr_t>( b3CreatePlayer( b3Recording_GetData( r ), b3Recording_GetSize( r ), workerCount ) );
	} );
	function( "b3DestroyPlayer(player)", +[]( uintptr_t p ) { b3DestroyPlayer( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_StepFrame(player)", +[]( uintptr_t p ) { return b3RecPlayer_StepFrame( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_Restart(player)", +[]( uintptr_t p ) { b3RecPlayer_Restart( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_SeekFrame(player, frame)", +[]( uintptr_t p, int frame ) { b3RecPlayer_SeekFrame( reinterpret_cast<b3RecPlayer*>( p ), frame ); } );
	function( "b3RecPlayer_GetWorldId(player)", +[]( uintptr_t p ) { return b3RecPlayer_GetWorldId( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_GetFrame(player)", +[]( uintptr_t p ) { return b3RecPlayer_GetFrame( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_GetFrameCount(player)", +[]( uintptr_t p ) { return b3RecPlayer_GetFrameCount( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_IsAtEnd(player)", +[]( uintptr_t p ) { return b3RecPlayer_IsAtEnd( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_GetBodyCount(player)", +[]( uintptr_t p ) { return b3RecPlayer_GetBodyCount( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_GetBodyId(player, index)", +[]( uintptr_t p, int index ) { return b3RecPlayer_GetBodyId( reinterpret_cast<b3RecPlayer*>( p ), index ); } );
	function( "b3RecPlayer_HasDiverged(player)", +[]( uintptr_t p ) { return b3RecPlayer_HasDiverged( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_GetDivergeFrame(player)", +[]( uintptr_t p ) { return b3RecPlayer_GetDivergeFrame( reinterpret_cast<b3RecPlayer*>( p ) ); } );
	function( "b3RecPlayer_SetWorkerCount(player, count)", +[]( uintptr_t p, int count ) { b3RecPlayer_SetWorkerCount( reinterpret_cast<b3RecPlayer*>( p ), count ); } );

	function( "b3World_Draw(worldId, handler)", &worldDraw );

	// Buffered debug draw. The facade owns the JS object and reads these tiers
	// in place. getDebugGeometry returns wasm-heap views; copy them to cache.
	class_<DebugDrawBuffer>( "DebugDrawBufferImpl" )
		.constructor<>()
		.function( "loadFrom", &DebugDrawBuffer::loadFrom )
		.function( "shapeCount", &DebugDrawBuffer::shapeCount )
		.function( "segmentCount", &DebugDrawBuffer::segmentCount )
		.function( "pointCount", &DebugDrawBuffer::pointCount )
		.function( "sphereCount", &DebugDrawBuffer::sphereCount )
		.function( "capsuleCount", &DebugDrawBuffer::capsuleCount )
		.function( "boxCount", &DebugDrawBuffer::boxCount )
		.function( "boundsCount", &DebugDrawBuffer::boundsCount )
		.function( "transformCount", &DebugDrawBuffer::transformCount )
		.function( "shapeI32Ptr", &DebugDrawBuffer::shapeI32Ptr )
		.function( "shapeF64Ptr", &DebugDrawBuffer::shapeF64Ptr )
		.function( "segmentI32Ptr", &DebugDrawBuffer::segmentI32Ptr )
		.function( "segmentF64Ptr", &DebugDrawBuffer::segmentF64Ptr )
		.function( "pointI32Ptr", &DebugDrawBuffer::pointI32Ptr )
		.function( "pointF32Ptr", &DebugDrawBuffer::pointF32Ptr )
		.function( "pointF64Ptr", &DebugDrawBuffer::pointF64Ptr )
		.function( "sphereI32Ptr", &DebugDrawBuffer::sphereI32Ptr )
		.function( "sphereF32Ptr", &DebugDrawBuffer::sphereF32Ptr )
		.function( "sphereF64Ptr", &DebugDrawBuffer::sphereF64Ptr )
		.function( "capsuleI32Ptr", &DebugDrawBuffer::capsuleI32Ptr )
		.function( "capsuleF32Ptr", &DebugDrawBuffer::capsuleF32Ptr )
		.function( "capsuleF64Ptr", &DebugDrawBuffer::capsuleF64Ptr )
		.function( "boxI32Ptr", &DebugDrawBuffer::boxI32Ptr )
		.function( "boxF32Ptr", &DebugDrawBuffer::boxF32Ptr )
		.function( "boxF64Ptr", &DebugDrawBuffer::boxF64Ptr )
		.function( "boundsI32Ptr", &DebugDrawBuffer::boundsI32Ptr )
		.function( "boundsF64Ptr", &DebugDrawBuffer::boundsF64Ptr )
		.function( "transformI32Ptr", &DebugDrawBuffer::transformI32Ptr )
		.function( "transformF64Ptr", &DebugDrawBuffer::transformF64Ptr );

	ret_function( "getDebugGeometry(id): DebugGeometry | null", &getDebugGeometry );
}
