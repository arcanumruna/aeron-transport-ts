#!/bin/sh
# Shallow-clones the pinned Aeron and Agrona sources that the port maps to (spec §2).
set -eu
AERON_TAG=1.53.3
AGRONA_TAG=2.6.1
DIR="${REFS_DIR:-.refs}"
mkdir -p "$DIR"
[ -d "$DIR/aeron" ] || git clone --quiet --depth 1 --branch "$AERON_TAG" https://github.com/aeron-io/aeron.git "$DIR/aeron"
[ -d "$DIR/agrona" ] || git clone --quiet --depth 1 --branch "$AGRONA_TAG" https://github.com/aeron-io/agrona.git "$DIR/agrona"
echo "Aeron $AERON_TAG and Agrona $AGRONA_TAG in $DIR"
