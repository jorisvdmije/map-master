import assert from "node:assert/strict";
import test from "node:test";
import { featureAnchor } from "../src/features/examples/property-anchor.ts";

const closeTo = (actual, expected) => {
  assert.ok(actual);
  assert.ok(
    Math.abs(actual[0] - expected[0]) < 1e-10,
    `longitude ${actual[0]} ≈ ${expected[0]}`,
  );
  assert.ok(
    Math.abs(actual[1] - expected[1]) < 1e-10,
    `latitude ${actual[1]} ≈ ${expected[1]}`,
  );
};
const polygon = (rings) => ({ type: "Polygon", coordinates: rings });

test("a point stays at its original location, independent of altitude and world copy", () => {
  assert.deepEqual(
    featureAnchor({ type: "Point", coordinates: [4.8934, 52.3731] }),
    [4.8934, 52.3731],
  );
  assert.deepEqual(
    featureAnchor({ type: "Point", coordinates: [4.8934, 52.3731, 180] }),
    [4.8934, 52.3731],
  );
  assert.deepEqual(
    featureAnchor({ type: "Point", coordinates: [364.8934, 52.3731] }),
    [364.8934, 52.3731],
  );
});

test("an asymmetric polygon uses its complete extent, not a vertex average", () => {
  const shape = polygon([
    [
      [4, 50],
      [4.1, 50],
      [8, 50],
      [4, 54],
      [4, 50],
    ],
  ]);
  closeTo(featureAnchor(shape), [6, 52]);
  assert.deepEqual(shape.coordinates[0][0], [4, 50]);
});

test("holes, repeated vertices and closing coordinates do not shift the extent center", () => {
  const exterior = [
    [4, 50],
    [8, 50],
    [8, 54],
    [4, 54],
    [4, 50],
  ];
  const hole = [
    [4.1, 50.1],
    [4.3, 50.1],
    [4.3, 50.3],
    [4.1, 50.1],
  ];
  const repeated = [
    [4, 50],
    [4, 50],
    [8, 50],
    [8, 54],
    [4, 54],
    [4, 50],
    [4, 50],
  ];
  assert.deepEqual(featureAnchor(polygon([exterior])), [6, 52]);
  assert.deepEqual(featureAnchor(polygon([exterior, hole])), [6, 52]);
  assert.deepEqual(featureAnchor(polygon([repeated, hole])), [6, 52]);
});

test("multipart polygons and points include every component", () => {
  const shape = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [4, 50],
          [5, 50],
          [5, 51],
          [4, 50],
        ],
      ],
      [
        [
          [10, 54],
          [12, 54],
          [12, 56],
          [10, 54],
        ],
      ],
    ],
  };
  closeTo(featureAnchor(shape), [8, 53]);
  closeTo(
    featureAnchor({
      type: "MultiPoint",
      coordinates: [
        [4, 50],
        [4.1, 50.1],
        [12, 56],
      ],
    }),
    [8, 53],
  );
});

test("lines and nested geometry collections combine their geographic bounds", () => {
  closeTo(
    featureAnchor({
      type: "LineString",
      coordinates: [
        [4, 50],
        [4.1, 50.1],
        [8, 54],
      ],
    }),
    [6, 52],
  );
  closeTo(
    featureAnchor({
      type: "MultiLineString",
      coordinates: [
        [
          [4, 50],
          [5, 51],
        ],
        [
          [10, 54],
          [12, 56],
        ],
      ],
    }),
    [8, 53],
  );
  closeTo(
    featureAnchor({
      type: "GeometryCollection",
      geometries: [
        {
          type: "LineString",
          coordinates: [
            [4, 50],
            [5, 51],
          ],
        },
        {
          type: "GeometryCollection",
          geometries: [{ type: "Point", coordinates: [12, 56] }],
        },
        { type: "Polygon", coordinates: [] },
      ],
    }),
    [8, 53],
  );
});

test("empty geometries do not invent an anchor", () => {
  for (const geometry of [
    { type: "Point", coordinates: [] },
    { type: "MultiPoint", coordinates: [] },
    { type: "LineString", coordinates: [] },
    { type: "Polygon", coordinates: [] },
    { type: "MultiPolygon", coordinates: [] },
    { type: "GeometryCollection", geometries: [] },
    {
      type: "GeometryCollection",
      geometries: [{ type: "Polygon", coordinates: [] }],
    },
  ])
    assert.equal(featureAnchor(geometry), null);
});

test("invalid positions reject the complete feature instead of using only its valid fragment", () => {
  for (const position of [
    [NaN, 50],
    [4, Infinity],
    [4],
    [4, 91],
    [4, -91],
    ["4", 50],
    [4, 50, NaN],
    null,
    [],
  ]) {
    assert.equal(
      featureAnchor({
        type: "LineString",
        coordinates: [[4, 50], position, [8, 54]],
      }),
      null,
    );
  }
  for (const geometry of [
    null,
    {},
    { type: "Feature", coordinates: [4, 50] },
    {
      type: "Polygon",
      coordinates: [
        [
          [4, 50],
          [8, 54],
        ],
        "invalid-ring",
      ],
    },
    {
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [4, 50] },
        { type: "Point", coordinates: [NaN, 50] },
      ],
    },
  ])
    assert.equal(featureAnchor(geometry), null);
});

test("longitude extents cross the dateline through the shorter arc", () => {
  closeTo(
    featureAnchor({
      type: "MultiPoint",
      coordinates: [
        [179, 10],
        [-179, 20],
      ],
    }),
    [180, 15],
  );
  closeTo(
    featureAnchor(
      polygon([
        [
          [178, 10],
          [-179, 10],
          [-179, 20],
          [178, 20],
          [178, 10],
        ],
      ]),
    ),
    [179.5, 15],
  );
  closeTo(
    featureAnchor({
      type: "LineString",
      coordinates: [
        [-178, 10],
        [179, 20],
      ],
    }),
    [-179.5, 15],
  );
  closeTo(
    featureAnchor({
      type: "MultiPoint",
      coordinates: [
        [180, 10],
        [-180, 20],
      ],
    }),
    [180, 15],
  );
});

test("longitude wrapping is invariant under coordinate order and repeated closing vertices", () => {
  const positions = [
    [178, 10],
    [-179, 20],
    [179, 15],
    [178, 10],
  ];
  const forward = featureAnchor({ type: "MultiPoint", coordinates: positions });
  const backward = featureAnchor({
    type: "MultiPoint",
    coordinates: [...positions].reverse(),
  });
  closeTo(forward, [179.5, 15]);
  assert.deepEqual(forward, backward);
});
