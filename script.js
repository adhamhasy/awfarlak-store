// script.js
import { db, ref, onValue, push, set } from "./firebase-config.js";

// State Management
let cart = JSON.parse(localStorage.getItem("cart") || "{}");
let wishlist = JSON.parse(localStorage.getItem("wishlist") || "[]");
let recentlyViewed = JSON.parse(localStorage.getItem("recently_viewed") || "[]");

let allProducts = [];
let filteredProducts = [];
let selectedCategory = "All";
let currentSortOption = "default";
let currentSortLabel = "Default";
let currentSelectedStars = 0;
let activeProductModalId = null;
let activeSelectedVariantFlavor = null;

// Pagination & Infinite Scroll
let currentPage = 1;
const pageSize = 8;
let scrollObserver = null;

// Leaflet Delivery Map
let mapInstance = null;
let mapMarker = null;
let selectedCoords = { lat: 31.2001, lng: 29.9187 };

// Debounce Utility for Search Input
function debounce(func, delay = 250) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), delay);
  };
}

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", debounce(() => window.filterAndSortProducts(), 250));
  }

  const submitReviewBtn = document.getElementById("submit-review-btn");
  if (submitReviewBtn) {
    submitReviewBtn.addEventListener("click", () => window.submitReview());
  }

  const maxPriceSlider = document.getElementById("maxPriceSlider");
  if (maxPriceSlider) {
    maxPriceSlider.addEventListener("input", window.updatePriceSliderDisplay);
  }

  const flavorFilter = document.getElementById("flavorFilter");
  const sizeFilter = document.getElementById("sizeFilter");
  if (flavorFilter) flavorFilter.addEventListener("change", window.filterAndSortProducts);
  if (sizeFilter) sizeFilter.addEventListener("change", window.filterAndSortProducts);

  setupInfiniteScroll();
  updateUI();
});

// Fetch Live Products from Firebase
onValue(ref(db, "products"), (snapshot) => {
  const data = snapshot.val();
  allProducts = [];

  if (!data) {
    document.getElementById("product-list").innerHTML = `
      <div class="col-12 text-center mt-5 py-5">
          <p class="text-muted">No products found in shop.</p>
      </div>`;
    return;
  }

  for (let id in data) {
    allProducts.push({ id, stock: data[id].stock ?? 5, ...data[id] });
  }

  renderCategoryButtons();
  renderSubFilters();
  window.filterAndSortProducts();
  renderRecentlyViewed();
  updateUI();
});

// Helper Ratings Functions
function getAverageRating(reviewsObj) {
  if (!reviewsObj) return { avg: 0, count: 0 };
  const vals = Object.values(reviewsObj);
  if (vals.length === 0) return { avg: 0, count: 0 };
  const sum = vals.reduce((a, b) => a + Number(b.rating || 0), 0);
  return { avg: (sum / vals.length).toFixed(1), count: vals.length };
}

function renderStarIcons(avgRating) {
  const rounded = Math.round(avgRating);
  let starsHTML = "";
  for (let i = 1; i <= 5; i++) {
    starsHTML += i <= rounded ? '<i class="bi bi-star-fill text-warning"></i>' : '<i class="bi bi-star text-muted"></i>';
  }
  return starsHTML;
}

window.selectStar = (rating) => {
  currentSelectedStars = rating;
  const stars = document.querySelectorAll("#review-stars-input .star-opt");
  stars.forEach((star, index) => {
    star.className = index < rating ? "bi bi-star-fill star-opt text-warning" : "bi bi-star star-opt text-secondary";
  });
};

// Filter Display & Controls
window.updatePriceSliderDisplay = () => {
  const slider = document.getElementById("maxPriceSlider");
  const display = document.getElementById("priceRangeDisplay");
  if (slider && display) {
    display.innerText = `0 - ${Number(slider.value).toLocaleString()} EGP`;
  }
  window.filterAndSortProducts();
};

window.resetFilters = () => {
  selectedCategory = "All";
  currentSortOption = "default";
  currentSortLabel = "Default";

  const searchEl = document.getElementById("searchInput");
  const flavorEl = document.getElementById("flavorFilter");
  const sizeEl = document.getElementById("sizeFilter");
  const sliderEl = document.getElementById("maxPriceSlider");

  if (searchEl) searchEl.value = "";
  if (flavorEl) flavorEl.value = "All";
  if (sizeEl) sizeEl.value = "All";
  if (sliderEl) sliderEl.value = 50000;

  renderCategoryButtons();
  window.updatePriceSliderDisplay();
  window.filterAndSortProducts();
};

window.selectSortOption = (option, label, btnEl) => {
  currentSortOption = option;
  currentSortLabel = label;

  document.querySelectorAll(".btn-sort-option").forEach((b) => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");

  const sortBadge = document.getElementById("sort-badge");
  if (sortBadge) {
    sortBadge.style.display = option === "default" ? "none" : "inline-block";
  }

  window.filterAndSortProducts();
  const sortModalEl = document.getElementById("sortModal");
  if (sortModalEl) {
    const modal = bootstrap.Modal.getInstance(sortModalEl);
    if (modal) modal.hide();
  }
};

// Main Filtering & Sorting Engine
window.filterAndSortProducts = () => {
  const searchEl = document.getElementById("searchInput");
  const flavorEl = document.getElementById("flavorFilter");
  const sizeEl = document.getElementById("sizeFilter");
  const maxPriceSlider = document.getElementById("maxPriceSlider");

  const term = searchEl ? searchEl.value.toLowerCase().trim() : "";
  const selectedFlavor = flavorEl ? flavorEl.value : "All";
  const selectedSize = sizeEl ? sizeEl.value : "All";
  const maxPrice = maxPriceSlider ? Number(maxPriceSlider.value) : 50000;

  const getEffectivePrice = (p) => {
    const hasDiscount = p.discountPrice && Number(p.discountPrice) < Number(p.price);
    return hasDiscount ? Number(p.discountPrice) : Number(p.price);
  };

  let activeFilterCount = 0;
  if (selectedCategory !== "All") activeFilterCount++;
  if (selectedFlavor !== "All") activeFilterCount++;
  if (selectedSize !== "All") activeFilterCount++;
  if (maxPrice < 50000) activeFilterCount++;

  const filterBadge = document.getElementById("filter-badge");
  if (filterBadge) {
    filterBadge.innerText = activeFilterCount;
    filterBadge.style.display = activeFilterCount > 0 ? "inline-block" : "none";
  }

  renderActiveFilterTags(term, selectedFlavor, selectedSize, maxPrice);

  filteredProducts = allProducts.filter((p) => {
    const effectivePrice = getEffectivePrice(p);
    const matchesSearch = !term || p.name.toLowerCase().includes(term);
    const matchesCategory = selectedCategory === "All" || (p.category || "Other") === selectedCategory;
    const matchesPrice = effectivePrice <= maxPrice;

    const itemFlavor = p.flavor || p.color || "";
    const hasFlavorMatch =
      selectedFlavor === "All" ||
      itemFlavor.toLowerCase().includes(selectedFlavor.toLowerCase()) ||
      (p.variants && p.variants.some((v) => (v.flavor || v.color || "").toLowerCase() === selectedFlavor.toLowerCase()));

    const itemSize = p.size || p.phoneType || "";
    const matchesSize =
      selectedSize === "All" ||
      itemSize.toLowerCase().includes(selectedSize.toLowerCase());

    return matchesSearch && matchesCategory && matchesPrice && hasFlavorMatch && matchesSize;
  });

  if (currentSortOption === "price-asc") filteredProducts.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
  else if (currentSortOption === "price-desc") filteredProducts.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));
  else if (currentSortOption === "name-asc") filteredProducts.sort((a, b) => a.name.localeCompare(b.name));
  else if (currentSortOption === "name-desc") filteredProducts.sort((a, b) => b.name.localeCompare(a.name));
  else if (currentSortOption === "rating-desc") filteredProducts.sort((a, b) => Number(getAverageRating(b.reviews).avg) - Number(getAverageRating(a.reviews).avg));
  else if (currentSortOption === "rating-asc") filteredProducts.sort((a, b) => Number(getAverageRating(a.reviews).avg) - Number(getAverageRating(b.reviews).avg));

  currentPage = 1;
  renderProductsBatched();
};

function renderActiveFilterTags(term, flavor, size, maxPrice) {
  const container = document.getElementById("active-filter-tags");
  if (!container) return;

  let tagsHTML = "";
  if (selectedCategory !== "All") tagsHTML += `<span class="badge bg-dark rounded-pill p-2">Category: ${selectedCategory}</span>`;
  if (flavor !== "All") tagsHTML += `<span class="badge bg-dark rounded-pill p-2">Flavor: ${flavor}</span>`;
  if (size !== "All") tagsHTML += `<span class="badge bg-dark rounded-pill p-2">Size: ${size}</span>`;
  if (maxPrice < 50000) tagsHTML += `<span class="badge bg-dark rounded-pill p-2">Max Price: ${maxPrice.toLocaleString()} EGP</span>`;
  if (term) tagsHTML += `<span class="badge bg-dark rounded-pill p-2">Search: "${term}"</span>`;

  container.innerHTML = tagsHTML;
}

// Render Grid Cards
function renderProductsBatched() {
  const list = document.getElementById("product-list");
  if (!list) return;

  const visibleItems = filteredProducts.slice(0, currentPage * pageSize);

  if (visibleItems.length === 0) {
    list.innerHTML = `<div class="col-12 text-center my-5 py-5"><p class="text-muted">No products match your criteria.</p></div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  visibleItems.forEach((p) => {
    const hasDiscount = p.discountPrice && Number(p.discountPrice) < Number(p.price);
    const displayPrice = hasDiscount ? p.discountPrice : p.price;
    const { avg } = getAverageRating(p.reviews);
    const isWishlisted = wishlist.includes(p.id);

    const col = document.createElement("div");
    col.className = "col-6 col-md-3 mb-4";

    const isOutOfStock = Number(p.stock) === 0;
    let stockBadge = isOutOfStock
      ? `<span class="badge bg-danger position-absolute top-0 end-0 m-2 z-2">Out of Stock</span>`
      : Number(p.stock) < 5
      ? `<span class="badge bg-warning text-dark position-absolute top-0 end-0 m-2 z-2">Only ${p.stock} Left!</span>`
      : "";

    col.innerHTML = `
      <div class="card border-0 product-card h-100 d-flex flex-column position-relative" style="cursor: pointer;">
          <button class="btn btn-sm rounded-circle position-absolute top-0 start-0 m-2 z-3 d-flex align-items-center justify-content-center ${
            isWishlisted ? "bg-danger text-white" : "bg-white text-dark shadow-sm"
          }" 
                  onclick="window.toggleWishlist('${p.id}', event)" title="Wishlist">
              <i class="bi ${isWishlisted ? "bi-heart-fill" : "bi-heart"}"></i>
          </button>
          ${stockBadge}
          <div style="position:relative" onclick="window.openProductModal('${p.id}')">
              <img src="${p.img}" loading="lazy" class="card-img-top shadow-sm" style="aspect-ratio: 1/1; object-fit: cover; border-radius: 20px;">
              ${hasDiscount ? '<span class="badge bg-dark" style="position:absolute; bottom:10px; left:10px;">SALE</span>' : ""}
          </div>
          <div class="card-body px-2 py-2 text-center d-flex flex-column justify-content-between" onclick="window.openProductModal('${p.id}')">
              <div>
                  <h6 class="fw-bold mb-1 small text-truncate">${p.name}</h6>
                  <div class="small mb-1">
                      ${renderStarIcons(avg)} <span class="text-muted" style="font-size:0.75rem;">(${avg})</span>
                  </div>
              </div>
              <p class="mb-2 small">
                  ${hasDiscount ? `<del class="text-danger me-1">${p.price}</del>` : ""}
                  <span class="fw-bold">${displayPrice} EGP</span>
              </p>
          </div>
          <button class="btn ${isOutOfStock ? "btn-secondary" : "btn-dark"} w-100 rounded-pill btn-sm d-flex justify-content-center align-items-center gap-1" 
                  ${isOutOfStock ? "disabled" : ""} 
                  onclick="window.addToCart('${p.id}', '${p.name.replace(/'/g, "")}', ${displayPrice}, '${p.img}', null, event)">
              <span>${isOutOfStock ? "Sold Out" : "Add to Bag"}</span>
          </button>
      </div>`;

    fragment.appendChild(col);
  });

  list.innerHTML = "";
  list.appendChild(fragment);
}

// Infinite Scroll Observer
function setupInfiniteScroll() {
  const sentinel = document.getElementById("scroll-sentinel");
  if (!sentinel) return;

  scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && currentPage * pageSize < filteredProducts.length) {
        currentPage++;
        renderProductsBatched();
      }
    },
    { rootMargin: "200px" }
  );

  scrollObserver.observe(sentinel);
}

// Product Details Modal
window.openProductModal = (id) => {
  const p = allProducts.find((item) => item.id === id);
  if (!p) return;
  activeProductModalId = id;
  activeSelectedVariantFlavor = null;

  recentlyViewed = recentlyViewed.filter((itemId) => itemId !== id);
  recentlyViewed.unshift(id);
  if (recentlyViewed.length > 8) recentlyViewed.pop();
  localStorage.setItem("recently_viewed", JSON.stringify(recentlyViewed));
  renderRecentlyViewed();

  const hasDiscount = p.discountPrice && Number(p.discountPrice) < Number(p.price);
  const displayPrice = hasDiscount ? p.discountPrice : p.price;
  const { avg, count } = getAverageRating(p.reviews);

  const mainImgEl = document.getElementById("modal-img");
  mainImgEl.src = p.img;

  const swatchesContainer = document.getElementById("variant-swatches-container");
  const swatchesList = document.getElementById("modal-flavor-swatches");

  if (p.variants && p.variants.length > 0) {
    if (swatchesContainer) swatchesContainer.style.display = "block";
    if (swatchesList) {
      swatchesList.innerHTML = p.variants
        .map(
          (v, idx) => `
        <button class="flavor-swatch-btn ${idx === 0 ? "active" : ""}" 
                onclick="window.selectFlavorVariant('${v.flavor || v.color}', '${v.img}', this)">
            ${v.flavor || v.color}
        </button>
      `
        )
        .join("");
    }

    activeSelectedVariantFlavor = p.variants[0].flavor || p.variants[0].color;
    if (p.variants[0].img) mainImgEl.src = p.variants[0].img;
  } else {
    if (swatchesContainer) swatchesContainer.style.display = "none";
    if (swatchesList) swatchesList.innerHTML = "";
  }

  const isOutOfStock = Number(p.stock) === 0;
  const actionContainer = document.getElementById("modal-action-container");
  if (!isOutOfStock) {
    actionContainer.innerHTML = `<button id="modal-add-btn" class="btn btn-luxury w-100 py-3 rounded-pill mb-4">ADD TO BAG</button>`;
    document.getElementById("modal-add-btn").onclick = (e) => {
      const currentImg = mainImgEl.src;
      window.addToCart(p.id, p.name, displayPrice, currentImg, activeSelectedVariantFlavor, e);
      bootstrap.Modal.getInstance(document.getElementById("productModal")).hide();
    };
  } else {
    actionContainer.innerHTML = `<button class="btn btn-secondary w-100 py-3 rounded-pill mb-4" disabled>OUT OF STOCK</button>`;
  }

  document.getElementById("modal-category").innerText = p.category || "General";
  document.getElementById("modal-name").innerText = p.name;
  document.getElementById("modal-desc").innerText = p.description || "No additional details provided.";
  document.getElementById("modal-price-container").innerHTML = `${
    hasDiscount ? `<del class="text-danger me-2">${p.price} EGP</del>` : ""
  }<span class="fw-bold fs-5">${displayPrice} EGP</span>`;

  document.getElementById("modal-avg-stars").innerHTML = renderStarIcons(avg);
  document.getElementById("modal-rating-text").innerText = `${avg} / 5 (${count} reviews)`;

  renderReviewsList(p.reviews);
  renderRelatedProducts(p.category, p.id);
  new bootstrap.Modal(document.getElementById("productModal")).show();
};

window.selectFlavorVariant = (flavorName, imgUrl, btnEl) => {
  activeSelectedVariantFlavor = flavorName;
  document.querySelectorAll(".flavor-swatch-btn").forEach((b) => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");

  if (imgUrl) {
    document.getElementById("modal-img").src = imgUrl;
  }
};

// Reviews Submission Engine
window.submitReview = async () => {
  if (!activeProductModalId) return;

  const authorInput = document.getElementById("review-author");
  const commentInput = document.getElementById("review-comment");

  const author = authorInput ? authorInput.value.trim() : "";
  const comment = commentInput ? commentInput.value.trim() : "";

  if (currentSelectedStars === 0) return alert("Please select a star rating!");
  if (!comment) return alert("Please leave a brief comment!");

  const newReview = {
    author: author || "Anonymous Client",
    comment: comment,
    rating: currentSelectedStars,
    date: new Date().toLocaleDateString("en-EG"),
  };

  await push(ref(db, `products/${activeProductModalId}/reviews`), newReview);

  if (authorInput) authorInput.value = "";
  if (commentInput) commentInput.value = "";
  window.selectStar(0);
  alert("Thank you for your review!");
};

function renderReviewsList(reviewsObj) {
  const container = document.getElementById("modal-reviews-list");
  if (!container) return;

  if (!reviewsObj) {
    container.innerHTML = `<p class="small text-muted mb-0">No reviews yet. Be the first to review!</p>`;
    return;
  }

  const reviews = Object.values(reviewsObj).reverse();
  container.innerHTML = reviews
    .map(
      (r) => `
    <div class="p-3 bg-cream-soft rounded-4">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span class="fw-bold small">${r.author || "Anonymous"}</span>
        <span class="small">${renderStarIcons(r.rating || 5)}</span>
      </div>
      <p class="small mb-0 text-muted">${r.comment || ""}</p>
    </div>`
    )
    .join("");
}

// Lightbox & Share
window.openLightbox = (src) => {
  const img = document.getElementById("lightbox-img");
  if (img) {
    img.src = src;
    new bootstrap.Modal(document.getElementById("lightboxModal")).show();
  }
};

window.shareProduct = () => {
  if (navigator.share) {
    navigator.share({
      title: document.getElementById("modal-name").innerText,
      url: window.location.href,
    });
  } else {
    navigator.clipboard.writeText(window.location.href);
    alert("Product link copied to clipboard!");
  }
};

// Related Products Renderer
function renderRelatedProducts(category, currentId) {
  const container = document.getElementById("related-products-list");
  const section = document.getElementById("related-products-section");
  if (!container || !section) return;

  const related = allProducts.filter((p) => p.category === category && p.id !== currentId).slice(0, 4);

  if (related.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  container.innerHTML = related
    .map(
      (p) => `
    <div class="card border-0 bg-cream-soft p-2 flex-shrink-0" style="width: 130px; cursor: pointer;" onclick="window.openProductModal('${p.id}')">
      <img src="${p.img}" loading="lazy" class="rounded-3 mb-2" style="width: 100%; height: 90px; object-fit: cover;">
      <div class="fw-bold small text-truncate text-center">${p.name}</div>
      <div class="small text-muted text-center">${p.price} EGP</div>
    </div>
  `
    )
    .join("");
}

// Cart Engine & Visual Animations
window.addToCart = (id, name, price, img, selectedFlavor = null, event = null) => {
  if (event && event.target) {
    animateFlyToCart(event.target);
  }

  const itemKey = selectedFlavor ? `${id}_${selectedFlavor}` : id;

  if (cart[itemKey]) {
    cart[itemKey].qty++;
  } else {
    cart[itemKey] = { id, name, price, img, flavor: selectedFlavor, qty: 1 };
  }

  updateUI();

  const t = document.getElementById("toast");
  if (t) {
    t.classList.add("show-toast");
    setTimeout(() => t.classList.remove("show-toast"), 2000);
  }
};

function animateFlyToCart(targetEl) {
  const cartBtn = document.querySelector(".bi-bag-fill");
  if (!cartBtn) return;

  const targetRect = targetEl.getBoundingClientRect();
  const cartRect = cartBtn.getBoundingClientRect();

  const flyer = document.createElement("div");
  flyer.style.cssText = `
    position: fixed;
    top: ${targetRect.top}px;
    left: ${targetRect.left}px;
    width: 24px;
    height: 24px;
    background: #2D2926;
    border-radius: 50%;
    z-index: 9999;
    pointer-events: none;
    transition: all 0.65s cubic-bezier(0.2, 1, 0.2, 1);
  `;
  document.body.appendChild(flyer);

  requestAnimationFrame(() => {
    flyer.style.top = `${cartRect.top}px`;
    flyer.style.left = `${cartRect.left}px`;
    flyer.style.opacity = "0.2";
    flyer.style.transform = "scale(0.3)";
  });

  setTimeout(() => flyer.remove(), 650);
}

// Cart Modal & Calculations
window.openCheckout = () => {
  const listDiv = document.getElementById("cart-items-list");
  const totalEl = document.getElementById("total-price");
  const savingsBadge = document.getElementById("cart-savings-badge");

  let total = 0;
  let totalSavings = 0;

  const keys = Object.keys(cart);
  if (keys.length === 0) {
    listDiv.innerHTML = `
      <div class="text-center py-5">
        <i class="bi bi-bag-x fs-1 text-muted d-block mb-2"></i>
        <p class="text-muted mb-0">Your bag is currently empty.</p>
      </div>`;
    totalEl.innerText = "0";
    if (savingsBadge) savingsBadge.style.display = "none";
  } else {
    listDiv.innerHTML = keys
      .map((key) => {
        const item = cart[key];
        total += item.price * item.qty;

        const productRef = allProducts.find((p) => p.id === item.id);
        if (productRef && productRef.discountPrice && Number(productRef.discountPrice) < Number(productRef.price)) {
          totalSavings += (Number(productRef.price) - Number(productRef.discountPrice)) * item.qty;
        }

        const itemFlavor = item.flavor || item.color;

        return `
        <div class="d-flex justify-content-between align-items-center mb-3 p-3 bg-cream-soft rounded-4">
            <div class="d-flex align-items-center gap-3">
                <img src="${item.img}" class="rounded-3" style="width: 48px; height: 48px; object-fit: cover;">
                <div>
                    <div class="fw-bold small">${item.name}</div>
                    ${itemFlavor ? `<span class="badge bg-dark text-white me-1">${itemFlavor}</span>` : ""}
                    <small class="text-muted">${item.price} EGP</small>
                </div>
            </div>
            <div class="d-flex align-items-center">
                <button class="btn btn-sm btn-outline-dark rounded-circle px-2" onclick="window.updateQty('${key}', -1)">-</button>
                <span class="mx-3 fw-bold">${item.qty}</span>
                <button class="btn btn-sm btn-outline-dark rounded-circle px-2" onclick="window.updateQty('${key}', 1)">+</button>
            </div>
        </div>`;
      })
      .join("");

    totalEl.innerText = total.toLocaleString();

    if (savingsBadge) {
      if (totalSavings > 0) {
        savingsBadge.innerText = `You save ${totalSavings.toLocaleString()} EGP on this order!`;
        savingsBadge.style.display = "block";
      } else {
        savingsBadge.style.display = "none";
      }
    }
  }

  new bootstrap.Modal(document.getElementById("cartModal")).show();
};

window.updateQty = (key, change) => {
  if (!cart[key]) return;
  cart[key].qty += change;
  if (cart[key].qty <= 0) delete cart[key];
  updateUI();
  window.openCheckout();
};

function updateUI() {
  localStorage.setItem("cart", JSON.stringify(cart));
  const totalQty = Object.values(cart).reduce((a, b) => a + b.qty, 0);
  const cartCountEl = document.getElementById("cart-count");
  if (cartCountEl) cartCountEl.innerText = totalQty;

  const wishlistCountEl = document.getElementById("wishlist-count");
  if (wishlistCountEl) {
    wishlistCountEl.innerText = wishlist.length;
    wishlistCountEl.style.display = wishlist.length > 0 ? "inline-block" : "none";
  }
}

// Category & Filters Renderers
function renderCategoryButtons() {
  const container = document.getElementById("modal-category-filters");
  if (!container) return;

  const categories = ["All", ...new Set(allProducts.map((p) => p.category || "Other"))];
  container.innerHTML = categories
    .map(
      (cat) => `
    <button class="btn ${
      cat === selectedCategory ? "btn-dark active-category" : "btn-outline-dark"
    } rounded-pill px-3 btn-sm" 
            onclick="window.selectCategory('${cat}', this)">${cat}</button>
  `
    )
    .join("");
}

window.selectCategory = (cat, btn) => {
  selectedCategory = cat;
  document.querySelectorAll("#modal-category-filters .btn").forEach((b) => {
    b.classList.remove("btn-dark", "active-category");
    b.classList.add("btn-outline-dark");
  });
  if (btn) {
    btn.classList.remove("btn-outline-dark");
    btn.classList.add("btn-dark", "active-category");
  }
  window.filterAndSortProducts();
};

function renderSubFilters() {
  const flavorSelect = document.getElementById("flavorFilter");
  const sizeSelect = document.getElementById("sizeFilter");

  if (flavorSelect) {
    const flavorsSet = new Set();
    allProducts.forEach((p) => {
      const f = p.flavor || p.color;
      if (f) f.split(",").forEach((c) => flavorsSet.add(c.trim()));
      if (p.variants) p.variants.forEach((v) => {
        const vf = v.flavor || v.color;
        if (vf) flavorsSet.add(vf.trim());
      });
    });

    flavorSelect.innerHTML =
      `<option value="All">All Flavors</option>` +
      Array.from(flavorsSet)
        .map((c) => `<option value="${c}">${c}</option>`)
        .join("");
  }

  if (sizeSelect) {
    const sizesSet = new Set();
    allProducts.forEach((p) => {
      const s = p.size || p.phoneType;
      if (s) sizesSet.add(s.trim());
    });

    sizeSelect.innerHTML =
      `<option value="All">All Sizes</option>` +
      Array.from(sizesSet)
        .map((t) => `<option value="${t}">${t}</option>`)
        .join("");
  }
}

// Wishlist Engine
window.openWishlistModal = () => {
  const container = document.getElementById("wishlist-items-list");
  const items = allProducts.filter((p) => wishlist.includes(p.id));

  if (items.length === 0) {
    container.innerHTML = `<p class="text-center text-muted py-4 mb-0">Your wishlist is empty.</p>`;
  } else {
    container.innerHTML = items
      .map(
        (p) => `
      <div class="d-flex justify-content-between align-items-center p-3 bg-cream-soft rounded-4">
          <div class="d-flex align-items-center gap-3">
              <img src="${p.img}" class="rounded-3" style="width: 48px; height: 48px; object-fit: cover;">
              <div>
                  <h6 class="fw-bold mb-0 small">${p.name}</h6>
                  <small class="text-muted">${p.price} EGP</small>
              </div>
          </div>
          <button class="btn btn-sm btn-outline-danger rounded-pill" onclick="window.toggleWishlist('${p.id}')">Remove</button>
      </div>
    `
      )
      .join("");
  }
  new bootstrap.Modal(document.getElementById("wishlistModal")).show();
};

window.toggleWishlist = (id, event) => {
  if (event) event.stopPropagation();
  const idx = wishlist.indexOf(id);
  if (idx > -1) wishlist.splice(idx, 1);
  else wishlist.push(id);

  localStorage.setItem("wishlist", JSON.stringify(wishlist));
  updateUI();
  window.filterAndSortProducts();
};

function renderRecentlyViewed() {
  const section = document.getElementById("recently-viewed-section");
  const container = document.getElementById("recently-viewed-list");
  if (!section || !container) return;

  const items = allProducts.filter((p) => recentlyViewed.includes(p.id));

  if (items.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";
  container.innerHTML = items
    .map(
      (p) => `
    <div class="card border-0 bg-cream-soft p-2 flex-shrink-0" style="width: 130px; cursor: pointer;" onclick="window.openProductModal('${p.id}')">
      <img src="${p.img}" loading="lazy" class="rounded-3 mb-2" style="width: 100%; height: 95px; object-fit: cover;">
      <div class="fw-bold small text-truncate text-center">${p.name}</div>
      <div class="small text-muted text-center">${p.price} EGP</div>
    </div>
  `
    )
    .join("");
}

// Map Initialization
const cartModalEl = document.getElementById("cartModal");
if (cartModalEl) {
  cartModalEl.addEventListener("shown.bs.modal", () => {
    if (mapInstance) return;
    const center = [31.2001, 29.9187];
    mapInstance = L.map("delivery-map").setView(center, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(mapInstance);
    mapMarker = L.marker(center, { draggable: true }).addTo(mapInstance);
    mapMarker.on("dragend", () => {
      const pos = mapMarker.getLatLng();
      selectedCoords = { lat: pos.lat.toFixed(5), lng: pos.lng.toFixed(5) };
      const addressInput = document.getElementById("selectedAddress");
      if (addressInput) {
        addressInput.value = `Lat: ${selectedCoords.lat}, Lng: ${selectedCoords.lng}`;
      }
    });
  });
}

// Confirming Orders to Firebase
window.confirmOrder = async () => {
  const nameInput = document.getElementById("name");
  const phoneInput = document.getElementById("phone");
  const addressInput = document.getElementById("selectedAddress");

  const name = nameInput ? nameInput.value.trim() : "";
  const phone = phoneInput ? phoneInput.value.trim() : "";
  const address = addressInput ? addressInput.value.trim() : "";

  if (!name || !phone || Object.keys(cart).length === 0) return alert("Please fill in your name, phone number, and add items to your cart!");

  const orderData = {
    custName: name,
    custPhone: "+20" + phone,
    custLocation: address,
    coords: selectedCoords,
    items: Object.values(cart)
      .map((i) => {
        const itemFlavor = i.flavor || i.color;
        return `${i.qty}x ${i.name}${itemFlavor ? ` (${itemFlavor})` : ""}`;
      })
      .join(", "),
    total: Object.values(cart).reduce((a, b) => a + b.price * b.qty, 0),
    time: new Date().toLocaleString("en-EG"),
  };

  await push(ref(db, "orders"), orderData);

  const modalEl = document.getElementById("cartModal");
  if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();

  const successToast = document.getElementById("successToast");
  if (successToast) successToast.classList.add("show-success");

  cart = {};
  updateUI();
  setTimeout(() => location.reload(), 2500);
};

// WhatsApp Order Direct Forwarding
window.orderViaWhatsApp = () => {
  const nameInput = document.getElementById("name");
  const phoneInput = document.getElementById("phone");
  const addressInput = document.getElementById("selectedAddress");

  const name = nameInput ? nameInput.value.trim() : "";
  const phone = phoneInput ? phoneInput.value.trim() : "";
  const address = addressInput ? addressInput.value.trim() : "";

  if (!name || !phone || Object.keys(cart).length === 0) return alert("Please fill in your name, phone number, and add items to your cart!");

  const itemsList = Object.values(cart)
    .map((i) => {
      const itemFlavor = i.flavor || i.color;
      return `- ${i.qty}x ${i.name}${itemFlavor ? ` [Flavor: ${itemFlavor}]` : ""} (${i.price * i.qty} EGP)`;
    })
    .join("\n");

  const total = Object.values(cart).reduce((a, b) => a + b.price * b.qty, 0);

  const text = `New Order from Supermarket Store\n\nName: ${name}\nPhone: ${phone}\nLocation: ${address}\n\nItems:\n${itemsList}\n\nTotal: ${total} EGP`;
  window.open(`https://wa.me/201208009551?text=${encodeURIComponent(text)}`, "_blank");
};